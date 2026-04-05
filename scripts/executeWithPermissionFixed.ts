/**
 * Execute calls using a granted permission - FIXED VERSION
 *
 * The key insight: When using permissions, the UserOp sender must be the
 * owner's smart account, not the spender's. The spender just provides the signature.
 */
import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

const CHAIN_ID = 84532;
const JAW_API_KEY = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PRIVATE_KEY = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID = process.env.PERMISSION_ID as Hex;
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

// Owner account (from permission) - this should be the UserOp sender
const OWNER_EOA = "0x6308EF7Cd4C39Ec11860A608E51dC7580D52Af68" as Address;

if (!JAW_API_KEY) throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PRIVATE_KEY) throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

async function resolveAgentId(permissionId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agents?permissionId=${permissionId}`);
  if (res.status === 404) {
    throw new Error(`No agent found in DB for permissionId ${permissionId}`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to resolve agentId: ${err.error ?? res.status}`);
  }
  const data = await res.json();
  return data.agent.agentId as string;
}

async function main() {
  console.log("=== Execute With Permission (Fixed) ===\n");

  // Create the spender's account (for signing)
  const spenderLocal = privateKeyToAccount(SPENDER_PRIVATE_KEY);
  console.log("Spender EOA   :", spenderLocal.address);
  console.log("Permission ID :", PERMISSION_ID);

  // Resolve agentId
  console.log("Resolving agentId from DB...");
  const agentId = await resolveAgentId(PERMISSION_ID);
  console.log("Agent ID      :", agentId, "(resolved from DB ✓)");

  // Create JAW Account from the spender's local account
  // This creates a smart account for the spender, but we'll pass the owner's address
  const spenderAccount = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Spender Smart Account :", spenderAccount.address);
  console.log("Owner EOA (expected)  :", OWNER_EOA);
  console.log();

  // Define the calls
  const RECIPIENT = "0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e" as Address;
  const AMOUNT = parseEther("0.0001");
  const calls = [{ to: RECIPIENT, value: AMOUNT }];

  console.log("Calls:");
  console.log("  To    :", RECIPIENT);
  console.log("  Value : 0.0001 ETH");
  console.log();

  // Send calls using the permission
  // The JAW SDK should handle using the owner as sender when permissionId is provided
  console.log("🚀 Submitting UserOp...");
  try {
    const result = await spenderAccount.sendCalls(calls, {
      permissionId: PERMISSION_ID,
    });
    console.log("  UserOp ID:", result.id);
    console.log("\n✓ UserOp submitted successfully!");
    console.log("  The permission execution should work now.");
  } catch (err: any) {
    console.error("\n❌ Error:", err.message);
    console.log("\nDebugging info:");
    console.log("  The permission expects:");
    console.log("    - account (owner): 0x6308EF7Cd4C39Ec11860A608E51dC7580D52Af68");
    console.log("    - spender: 0xCC2c2DEeb1327Ecd6d98EB052414132F136092f6");
    console.log("  The script provides:");
    console.log("    - spender EOA:", spenderLocal.address);
    console.log("    - spender smart account:", spenderAccount.address);
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
