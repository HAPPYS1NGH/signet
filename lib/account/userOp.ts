import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
} from "viem";
import { justanAccountAbi } from "../abi/justanAccount";
import { entryPointAbi } from "../abi/entryPoint";
import { factoryAbi } from "../abi/factory";
import { publicClient, bundlerRpc } from "../clients";
import {
  CHAIN_ID,
  ENTRY_POINT_ADDRESS,
  FACTORY_ADDRESS,
  PERMISSIONS_MANAGER,
  STUB_SIGNATURE,
} from "../config";

// --- Types ---

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

/**
 * UserOp in the UNPACKED RPC format that bundlers expect for EntryPoint v0.7/v0.8.
 * This is NOT the packed on-chain format.
 */
export interface UserOp {
  sender: Address;
  nonce: bigint;
  factory: Address | null;
  factoryData: Hex | null;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: Address | null;
  paymasterVerificationGasLimit: bigint | null;
  paymasterPostOpGasLimit: bigint | null;
  paymasterData: Hex | null;
  signature: Hex;
}

/** Signed EIP-7702 authorization — matches viem's SignAuthorizationReturnType */
export interface SignedEip7702Auth {
  chainId: number;
  address: Address;
  nonce: number;
  yParity: number;
  r: Hex;
  s: Hex;
}

interface GasEstimate {
  preVerificationGas: bigint;
  verificationGasLimit: bigint;
  callGasLimit: bigint;
}

// --- Call Encoding ---

/**
 * Encode an initialize call with two owners: [eoaAddress, permissionsManager].
 */
export function encodeInitialize(eoaAddress: Address): Call {
  return {
    target: eoaAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: justanAccountAbi,
      functionName: "initialize",
      args: [
        [
          pad(eoaAddress),
          pad(PERMISSIONS_MANAGER),
        ],
      ],
    }),
  };
}

/**
 * Get factory + factoryData for the initialize UserOp.
 * The factory calls createAccount which internally calls initialize.
 * Required because initialize has access control (only callable by factory).
 */
export function getInitFactoryArgs(eoaAddress: Address): { factory: Address; factoryData: Hex } {
  return {
    factory: FACTORY_ADDRESS,
    factoryData: encodeFunctionData({
      abi: factoryAbi,
      functionName: "createAccount",
      args: [
        [pad(eoaAddress), pad(PERMISSIONS_MANAGER)],
        0n,
      ],
    }),
  };
}

/**
 * Encode calls into callData for the smart account.
 * Uses execute() for single calls, executeBatch() for multiple.
 */
export function encodeCallData(calls: Call[]): Hex {
  if (calls.length === 0) {
    // No calls — used when factory handles initialization.
    // Still need valid callData; use empty executeBatch.
    return encodeFunctionData({
      abi: justanAccountAbi,
      functionName: "executeBatch",
      args: [[]],
    });
  }
  if (calls.length === 1) {
    return encodeFunctionData({
      abi: justanAccountAbi,
      functionName: "execute",
      args: [calls[0]!.target, calls[0]!.value, calls[0]!.data],
    });
  }
  return encodeFunctionData({
    abi: justanAccountAbi,
    functionName: "executeBatch",
    args: [calls],
  });
}

// --- Nonce ---

export async function getAccountNonce(sender: Address): Promise<bigint> {
  return publicClient.readContract({
    address: ENTRY_POINT_ADDRESS,
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [sender, 0n],
  });
}

// --- Build UserOp ---

/**
 * Build a UserOp in unpacked RPC format.
 * @param isEip7702 - If true, sets factory to 0x7702 (EIP-7702 deployment marker)
 */
export async function buildUserOp(
  sender: Address,
  calls: Call[],
  factoryArgs?: { factory: Address; factoryData: Hex },
): Promise<UserOp> {
  const nonce = await getAccountNonce(sender);
  const callData = encodeCallData(calls);

  const feeData = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = feeData.maxFeePerGas ?? 1_000_000_000n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 1_000_000n;

  return {
    sender,
    nonce,
    factory: factoryArgs?.factory ?? null,
    factoryData: factoryArgs?.factoryData ?? null,
    callData,
    callGasLimit: 500_000n,           // placeholder, overwritten by estimation
    verificationGasLimit: 500_000n,   // placeholder
    preVerificationGas: 100_000n,     // placeholder
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: STUB_SIGNATURE,
  };
}

// --- Gas Estimation ---

export async function estimateGas(
  userOp: UserOp,
  authorization?: SignedEip7702Auth,
): Promise<GasEstimate> {
  const rpcOp = formatUserOpForRpc(userOp, authorization);

  const result = (await bundlerRpc(
    "eth_estimateUserOperationGas",
    [rpcOp, ENTRY_POINT_ADDRESS],
  )) as Record<string, string>;

  return {
    preVerificationGas: BigInt(result.preVerificationGas),
    verificationGasLimit: BigInt(result.verificationGasLimit),
    callGasLimit: BigInt(result.callGasLimit),
  };
}

/**
 * Apply gas estimates to the UserOp with a 20% buffer.
 */
export function applyGasEstimate(userOp: UserOp, gas: GasEstimate): UserOp {
  const buf = (v: bigint) => (v * 120n) / 100n;
  return {
    ...userOp,
    preVerificationGas: buf(gas.preVerificationGas),
    verificationGasLimit: buf(gas.verificationGasLimit),
    callGasLimit: buf(gas.callGasLimit),
    signature: "0x", // clear stub — will be filled after signing
  };
}

// --- UserOp Hash (computed locally) ---

/**
 * Compute the UserOp hash locally using the same formula as EntryPoint v0.7/v0.8.
 * This avoids calling the on-chain function which reverts if sender has no code.
 *
 * hash = keccak256(abi.encode(innerHash, entryPointAddress, chainId))
 * innerHash = keccak256(abi.encode(sender, nonce, hashInitCode, hashCallData,
 *                                   accountGasLimits, preVerificationGas, gasFees, hashPaymasterAndData))
 */
export function getUserOpHash(userOp: UserOp, chainId: number = CHAIN_ID): Hex {
  const packed = toPackedUserOp(userOp);

  const innerHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        packed.sender,
        packed.nonce,
        keccak256(packed.initCode === "0x" ? "0x" : packed.initCode),
        keccak256(packed.callData),
        packed.accountGasLimits as Hex,
        packed.preVerificationGas,
        packed.gasFees as Hex,
        keccak256(packed.paymasterAndData === "0x" ? "0x" : packed.paymasterAndData),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [innerHash, ENTRY_POINT_ADDRESS, BigInt(chainId)],
    ),
  );
}

// --- Submit ---

export async function submitUserOp(
  userOp: UserOp,
  authorization?: SignedEip7702Auth,
): Promise<Hex> {
  const rpcOp = formatUserOpForRpc(userOp, authorization);
  return (await bundlerRpc("eth_sendUserOperation", [rpcOp, ENTRY_POINT_ADDRESS])) as Hex;
}

export async function waitForUserOpReceipt(
  userOpHash: Hex,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<unknown> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const receipt = await bundlerRpc("eth_getUserOperationReceipt", [userOpHash]);
      if (receipt) return receipt;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("UserOp receipt timeout");
}

// --- Format Helpers ---

/**
 * Format UserOp for the bundler RPC (UNPACKED format).
 * Authorization is embedded inside the UserOp object (not as a 3rd RPC param).
 */
function formatUserOpForRpc(
  op: UserOp,
  authorization?: SignedEip7702Auth,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    sender: op.sender,
    nonce: toHex(op.nonce),
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    signature: op.signature,
  };

  // Factory fields
  if (op.factory) {
    result.factory = op.factory;
    result.factoryData = op.factoryData ?? "0x";
  }

  // Paymaster fields
  if (op.paymaster) {
    result.paymaster = op.paymaster;
    result.paymasterVerificationGasLimit = toHex(op.paymasterVerificationGasLimit ?? 0n);
    result.paymasterPostOpGasLimit = toHex(op.paymasterPostOpGasLimit ?? 0n);
    result.paymasterData = op.paymasterData ?? "0x";
  }

  // EIP-7702 authorization — embedded in the UserOp object
  if (authorization) {
    result.authorizationList = [authorization];
  }

  return result;
}

/**
 * Pack a UserOp into the on-chain PackedUserOperation format.
 * Used only for calling EntryPoint.getUserOpHash() on-chain.
 */
function toPackedUserOp(op: UserOp) {
  // Pack initCode: factory (20 bytes) + factoryData, or 0x if no factory
  const initCode: Hex = op.factory
    ? (`${op.factory}${(op.factoryData ?? "0x").slice(2)}` as Hex)
    : "0x";

  // Pack accountGasLimits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
  const accountGasLimits = packTwo128(op.verificationGasLimit, op.callGasLimit);

  // Pack gasFees: maxPriorityFeePerGas (16 bytes) | maxFeePerGas (16 bytes)
  const gasFees = packTwo128(op.maxPriorityFeePerGas, op.maxFeePerGas);

  // Pack paymasterAndData
  let paymasterAndData: Hex = "0x";
  if (op.paymaster) {
    const pvgl = (op.paymasterVerificationGasLimit ?? 0n).toString(16).padStart(32, "0");
    const ppogl = (op.paymasterPostOpGasLimit ?? 0n).toString(16).padStart(32, "0");
    const pd = (op.paymasterData ?? "0x").slice(2);
    paymasterAndData = `${op.paymaster}${pvgl}${ppogl}${pd}` as Hex;
  }

  return {
    sender: op.sender,
    nonce: op.nonce,
    initCode,
    callData: op.callData,
    accountGasLimits,
    preVerificationGas: op.preVerificationGas,
    gasFees,
    paymasterAndData,
    signature: op.signature,
  };
}

function packTwo128(high: bigint, low: bigint): Hex {
  const h = high.toString(16).padStart(32, "0");
  const l = low.toString(16).padStart(32, "0");
  return `0x${h}${l}`;
}
