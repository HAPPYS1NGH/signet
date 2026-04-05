/**
 * Preview the complete payload for granting a permission.
 * Shows the calls array, UserOp structure, and final calldata before signing.
 */
import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseEther,
  pad,
  toHex,
  keccak256,
  encodeAbiParameters,
} from "viem";
import {
  buildPermission,
  buildApproveCall,
  type GrantPermissionParams,
} from "../lib/account/permissions";
import {
  buildUserOp,
  encodeCallData,
  type UserOp,
} from "../lib/account/userOp";
import { CHAIN_ID, ENTRY_POINT_ADDRESS, PERMISSIONS_MANAGER, STUB_SIGNATURE } from "../lib/config";
import { permissionsManagerAbi } from "../lib/abi/permissionsManager";

// Example configuration - matches what would be used in GrantPermission.tsx
const EXAMPLE_CONFIG = {
  // Owner's EOA (the Ledger address)
  ownerEoa: "0x6308EF7Cd4C39Ec11860A608E51dC7580D52Af68" as Address,
  
  // Spender EOA (the agent's private key address)
  spenderEoa: "0xB0615E246d2a9701C1Bf7863757901A1Ca566Bb7" as Address,
  
  // Permission settings
  expiryHours: 24,
  callTarget: "0x3232323232323232323232323232323232323232" as Address, // Any contract (wildcard)
  callSelector: "0xe0e0e0e0" as Hex, // Empty calldata selector
  spendToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address, // Native ETH
  spendAllowance: parseEther("0.01"), // 0.01 ETH
  spendPeriod: "day" as const,
};

function formatJson(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_, v) => {
      if (typeof v === "bigint") return v.toString() + "n";
      if (v instanceof Date) return v.toISOString();
      return v;
    },
    2
  );
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║     Grant Permission - Complete Payload Preview                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const { ownerEoa, spenderEoa, expiryHours, callTarget, callSelector, spendToken, spendAllowance, spendPeriod } = EXAMPLE_CONFIG;

  console.log("📋 INPUT CONFIGURATION:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(formatJson({
    ownerEoa,
    spenderEoa,
    expiryHours,
    callTarget,
    callSelector,
    spendToken,
    spendAllowance: spendAllowance.toString() + " wei (" + Number(spendAllowance) / 1e18 + " ETH)",
    spendPeriod,
  }));
  console.log();

  // Step 1: Build Permission Params
  console.log("🔧 STEP 1: GrantPermissionParams");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  const params: GrantPermissionParams = {
    spender: spenderEoa,
    expiry: Math.floor(Date.now() / 1000) + expiryHours * 3600,
    calls: callTarget
      ? [{ target: callTarget, selector: callSelector }]
      : [],
    spends: spendAllowance > 0n
      ? [{ token: spendToken, allowance: spendAllowance, unit: spendPeriod }]
      : [],
  };

  console.log(formatJson(params));
  console.log();

  // Step 2: Build Full Permission Struct
  console.log("🔧 STEP 2: Permission Struct (with generated salt)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  const permission = buildPermission(ownerEoa, params);
  console.log(formatJson(permission));
  console.log();

  // Step 3: Build the Approve Call
  console.log("🔧 STEP 3: Approve Call (what the smart account will execute)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  const approveCall = buildApproveCall(permission);
  console.log(formatJson(approveCall));
  console.log();

  // Step 3b: Decode the approve call for clarity
  console.log("   📖 Decoded Approve Call:");
  console.log("   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const decodedApprove = encodeFunctionData({
    abi: permissionsManagerAbi,
    functionName: "approve",
    args: [{
      account: permission.account,
      spender: permission.spender,
      start: permission.start,
      end: permission.end,
      salt: permission.salt,
      calls: permission.calls.map(c => ({ target: c.target, selector: c.selector, checker: c.checker })),
      spends: permission.spends.map(s => ({ 
        token: s.token, 
        allowance: s.allowance, 
        unit: { minute: 0, hour: 1, day: 2, week: 3, month: 4, forever: 5 }[s.unit], 
        multiplier: s.multiplier 
      })),
    }],
  });
  console.log("   Target:", PERMISSIONS_MANAGER);
  console.log("   Value:", "0");
  console.log("   Calldata:", decodedApprove);
  console.log("   Function: PermissionsManager.approve(Permission memory)");
  console.log();

  // Step 4: Build the UserOp
  console.log("🔧 STEP 4: User Operation (UNPACKED RPC format)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  const userOp = await buildUserOp(ownerEoa, [approveCall]);
  
  // Format for display
  const displayUserOp = {
    ...userOp,
    nonce: userOp.nonce.toString(),
    callGasLimit: userOp.callGasLimit.toString(),
    verificationGasLimit: userOp.verificationGasLimit.toString(),
    preVerificationGas: userOp.preVerificationGas.toString(),
    maxFeePerGas: userOp.maxFeePerGas.toString(),
    maxPriorityFeePerGas: userOp.maxPriorityFeePerGas.toString(),
  };
  console.log(formatJson(displayUserOp));
  console.log();

  // Step 5: Call Data (what the EntryPoint executes)
  console.log("🔧 STEP 5: UserOp.callData (Smart Account Execute)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Raw:", userOp.callData);
  console.log();
  console.log("Decoded: The smart account will call executeBatch([approveCall]) or execute(target, value, data)");
  console.log("This wraps the PermissionsManager.approve() call through the smart account.");
  console.log();

  // Step 6: UserOp Hash (what gets signed)
  console.log("🔧 STEP 6: UserOp Hash (EIP-712 Typed Data)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Calculate the hash locally
  const userOpHash = calculateUserOpHash(userOp);
  console.log("UserOp Hash:", userOpHash);
  console.log();
  
  console.log("EIP-712 Typed Data Structure for Ledger Signing:");
  console.log(formatJson({
    domain: {
      name: "ERC4337",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: ENTRY_POINT_ADDRESS,
    },
    types: {
      PackedUserOperation: [
        { name: "sender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "callData", type: "bytes" },
        { name: "accountGasLimits", type: "bytes32" },
        { name: "preVerificationGas", type: "uint256" },
        { name: "gasFees", type: "bytes32" },
        { name: "paymasterAndData", type: "bytes" },
      ],
    },
    primaryType: "PackedUserOperation",
    message: {
      sender: userOp.sender,
      nonce: userOp.nonce.toString(),
      initCode: "0x (no factory)",
      callData: userOp.callData.slice(0, 50) + "...",
      accountGasLimits: "packed(verificationGasLimit, callGasLimit)",
      preVerificationGas: userOp.preVerificationGas.toString(),
      gasFees: "packed(maxPriorityFeePerGas, maxFeePerGas)",
      paymasterAndData: "0x (no paymaster)",
    },
  }));
  console.log();

  // Step 7: Complete Transaction Flow
  console.log("📊 COMPLETE TRANSACTION FLOW");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("1. Ledger Owner signs the UserOp hash");
  console.log("   ↓");
  console.log("2. Bundler receives signed UserOp");
  console.log("   ↓");
  console.log("3. EntryPoint validates signature and calls smart account");
  console.log("   ↓");
  console.log("4. Smart account executes: execute(PermissionsManager, 0, approve(permission))");
  console.log("   ↓");
  console.log("5. PermissionsManager stores the permission on-chain");
  console.log("   ↓");
  console.log("6. Event emitted: PermissionApproved(permissionId, permission)");
  console.log();

  // Step 8: Events to Watch
  console.log("📊 EVENTS EMITTED");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Topic 0 (PermissionApproved):");
  console.log("  0x84b07255c6c3e177513e059044c77d305a6aecf39fbe512d64dcd3cebb59d5ea");
  console.log();
  console.log("Topic 1 (permissionId):");
  console.log("  " + keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint48" }, { type: "uint48" }, { type: "uint256" },
     { type: "tuple[]", components: [{ type: "address" }, { type: "bytes4" }, { type: "address" }] },
     { type: "tuple[]", components: [{ type: "address" }, { type: "uint160" }, { type: "uint8" }, { type: "uint16" }] }],
    [permission.account, permission.spender, permission.start, permission.end, permission.salt,
     permission.calls.map(c => [c.target, c.selector, c.checker]),
     permission.spends.map(s => [s.token, s.allowance, { minute: 0, hour: 1, day: 2, week: 3, month: 4, forever: 5 }[s.unit], s.multiplier])]
  )));
  console.log("  (Note: This is the hash of the permission struct, computed by the contract)");
  console.log();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  END OF PREVIEW                                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

// Helper to calculate UserOp hash (simplified version)
function calculateUserOpHash(userOp: UserOp): Hex {
  const initCode: Hex = userOp.factory
    ? (`${userOp.factory}${(userOp.factoryData ?? "0x").slice(2)}` as Hex)
    : "0x";

  const accountGasLimits = packTwo128(userOp.verificationGasLimit, userOp.callGasLimit);
  const gasFees = packTwo128(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas);

  let paymasterAndData: Hex = "0x";
  if (userOp.paymaster) {
    const pvgl = (userOp.paymasterVerificationGasLimit ?? 0n).toString(16).padStart(32, "0");
    const ppogl = (userOp.paymasterPostOpGasLimit ?? 0n).toString(16).padStart(32, "0");
    const pd = (userOp.paymasterData ?? "0x").slice(2);
    paymasterAndData = `${userOp.paymaster}${pvgl}${ppogl}${pd}` as Hex;
  }

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
        userOp.sender,
        userOp.nonce,
        keccak256(initCode === "0x" ? "0x" : initCode),
        keccak256(userOp.callData),
        accountGasLimits,
        userOp.preVerificationGas,
        gasFees,
        keccak256(paymasterAndData === "0x" ? "0x" : paymasterAndData),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [innerHash, ENTRY_POINT_ADDRESS, BigInt(CHAIN_ID)],
    ),
  );
}

function packTwo128(high: bigint, low: bigint): Hex {
  const h = high.toString(16).padStart(32, "0");
  const l = low.toString(16).padStart(32, "0");
  return `0x${h}${l}` as Hex;
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
