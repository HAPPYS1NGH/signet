import {
  type Address,
  type Hex,
  encodeFunctionData,
  pad,
  serializeTransaction,
  hexToBytes,
} from "viem";
import { publicClient } from "../clients";
import { CHAIN_ID, JUSTAN_ACCOUNT_IMPL, PERMISSIONS_MANAGER } from "../config";
import { justanAccountAbi } from "../abi/justanAccount";

/**
 * Check if the EOA already has an EIP-7702 delegation active.
 */
export async function isDelegated(address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return code?.startsWith("0xef0100") ?? false;
}

/**
 * Check if the account is already initialized (ownerCount > 0).
 */
export async function isInitialized(address: Address): Promise<boolean> {
  try {
    const count = await publicClient.readContract({
      address,
      abi: justanAccountAbi,
      functionName: "ownerCount",
    });
    return count > 0n;
  } catch {
    return false;
  }
}

/**
 * Build an unsigned EIP-7702 (type 4) transaction that:
 * 1. Sets the delegation to JustanAccount implementation
 * 2. Calls initialize() on the EOA (now a smart account) with two owners
 *
 * This does delegation + initialization in a SINGLE transaction.
 */
export async function buildDelegationAndInitTx(
  eoaAddress: Address,
  signedAuth: { chainId: number; address: Address; nonce: number; yParity: number; r: Hex; s: Hex },
) {
  const nonce = await publicClient.getTransactionCount({ address: eoaAddress });
  const feeData = await publicClient.estimateFeesPerGas();

  // Encode initialize(owners) — called on the EOA itself (which becomes the smart account)
  const initData = encodeFunctionData({
    abi: justanAccountAbi,
    functionName: "initialize",
    args: [
      [
        pad(eoaAddress),          // owner[0] = Ledger EOA
        pad(PERMISSIONS_MANAGER), // owner[1] = PermissionsManager
      ],
    ],
  });

  const tx = {
    type: "eip7702" as const,
    chainId: CHAIN_ID,
    nonce,
    to: eoaAddress,                // call self — the delegation makes this a smart account call
    value: 0n,
    data: initData,                // initialize with two owners
    maxFeePerGas: feeData.maxFeePerGas ?? 1_000_000_000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000n,
    gas: 300_000n,                 // delegation + init needs more gas
    authorizationList: [signedAuth],
  };

  const serializedUnsigned = serializeTransaction(tx);
  const unsignedBytes = hexToBytes(serializedUnsigned);

  console.log("[delegation] Built type 4 tx:", {
    nonce,
    to: eoaAddress,
    data: initData.slice(0, 10) + "...",
    gas: tx.gas,
    authAddress: signedAuth.address,
  });

  return { tx, unsignedBytes };
}

/**
 * Assemble a signed delegation tx and broadcast it.
 */
export async function broadcastDelegationTx(
  tx: Parameters<typeof serializeTransaction>[0],
  signature: { r: string; s: string; v: number },
): Promise<Hex> {
  const strip0x = (h: string) => h.startsWith("0x") ? h.slice(2) : h;
  const yParity = signature.v >= 27 ? signature.v - 27 : signature.v;

  const signedTx = serializeTransaction(tx, {
    r: `0x${strip0x(signature.r)}` as Hex,
    s: `0x${strip0x(signature.s)}` as Hex,
    yParity,
  });

  console.log("[delegation] Broadcasting signed tx...");
  return publicClient.request({
    method: "eth_sendRawTransaction",
    params: [signedTx],
  });
}

/**
 * Wait for a transaction to be confirmed and verify delegation + initialization.
 */
export async function waitAndVerify(hash: Hex, eoaAddress: Address) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("[delegation] Tx confirmed:", receipt.status, "block:", receipt.blockNumber);

  // Verify delegation was set
  const code = await publicClient.getCode({ address: eoaAddress });
  const delegated = code?.startsWith("0xef0100") ?? false;
  console.log("[delegation] Code after tx:", code?.slice(0, 20) ?? "empty", "delegated:", delegated);

  if (!delegated) {
    throw new Error("Delegation not set — authorization may be invalid. Check the Ledger signed correctly.");
  }

  // If tx reverted but delegation was set, it means the initialize call failed.
  // This is OK — delegation is on-chain, we just need to initialize separately.
  if (receipt.status === "reverted") {
    console.warn("[delegation] Tx reverted but delegation is active. Initialize call may need a separate tx.");
  }

  // Verify initialization
  const initialized = await isInitialized(eoaAddress);
  console.log("[delegation] Initialized:", initialized);

  return { delegated, initialized, receipt };
}
