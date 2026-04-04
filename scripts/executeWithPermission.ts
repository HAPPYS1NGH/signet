/**
 * Execute calls using a granted permission.
 *
 * This script acts as the SPENDER — it uses a permission previously granted
 * by the Ledger smart account owner to execute calls on behalf of the account.
 * After execution it logs the tx to our DB as an "autonomous" record.
 *
 * Usage:
 *   npx tsx scripts/executeWithPermission.ts
 *
 * Environment variables:
 *   SPENDER_PRIVATE_KEY     - Private key of the spender (who was granted the permission)
 *   PERMISSION_ID           - The permissionId returned from grantPermissions
 *   AGENT_ID                - Agent ID from our DB (from grant permission step)
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Optional:
 *   API_BASE                - Next.js base URL (default: http://localhost:3000)
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

// --- Config ---
const CHAIN_ID          = 84532; // Base Sepolia
const JAW_API_KEY       = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PRIVATE_KEY = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID     = process.env.PERMISSION_ID as Hex;
const AGENT_ID          = process.env.AGENT_ID!;
const API_BASE          = process.env.API_BASE ?? "http://localhost:3000";

if (!JAW_API_KEY)         throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PRIVATE_KEY) throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID)       throw new Error("PERMISSION_ID not set");
if (!AGENT_ID)            throw new Error("AGENT_ID not set");

// --- Helpers ---

type JawAccount = Awaited<ReturnType<typeof Account.fromLocalAccount>>;

/** Poll getCallStatus until the UserOp is confirmed, failed, or timed out */
async function waitForCalls(
  account: JawAccount,
  id: Hex,
  timeoutMs = 120_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("\nWaiting for confirmation");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    process.stdout.write(".");

    const status = account.getCallStatus(id);
    if (status) {
      if (status.status === 200) {
        process.stdout.write("\n");
        return status.receipts?.[0]?.transactionHash ?? null;
      }
      if (status.status === 400 || status.status === 500) {
        throw new Error(`UserOp failed with bundler status ${status.status}`);
      }
    }
  }

  throw new Error("Timed out waiting for UserOp confirmation (120s)");
}

/** Log an executed tx to our DB as "autonomous" */
async function logToDb(params: {
  agentId: string;
  calls: { to: string; value: string; data: string }[];
  description: string;
  userOpHash: string;
  txHash: string | null;
}) {
  const res = await fetch(`${API_BASE}/api/agents/${params.agentId}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "autonomous",
      calls: params.calls,
      description: params.description,
      userOpHash: params.userOpHash,
      txHash: params.txHash,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.warn("  ⚠ DB log failed:", data.error ?? res.status);
    return null;
  }

  return data as { txId: string; status: string };
}

// --- Main ---

async function main() {
  console.log("=== Execute With Permission ===\n");

  // 1. Create the spender's local account from private key
  const spenderLocal = privateKeyToAccount(SPENDER_PRIVATE_KEY);
  console.log("Spender EOA     :", spenderLocal.address);
  console.log("Permission ID   :", PERMISSION_ID);
  console.log("Agent ID        :", AGENT_ID);

  // 2. Create JAW Account from the spender's local account
  const spenderAccount = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Smart account   :", spenderAccount.address);

  // 3. Define the calls to execute
  //    Edit these to match whatever action you want to perform.
  const RECIPIENT = "0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e" as Address;
  const AMOUNT    = parseEther("0.0001");
  const DESCRIPTION = `Autonomous transfer: 0.0001 ETH → ${RECIPIENT.slice(0, 10)}...`;

  const calls = [{ to: RECIPIENT, value: AMOUNT }];

  console.log("\nCalls:");
  console.log("  To     :", RECIPIENT);
  console.log("  Value  : 0.0001 ETH");

  // 4. Send calls using the permission
  console.log("\n🚀 Submitting UserOp...");
  const result = await spenderAccount.sendCalls(calls, {
    permissionId: PERMISSION_ID,
  });

  console.log("  UserOp ID:", result.id);

  // 5. Wait for on-chain confirmation
  const txHash = await waitForCalls(spenderAccount, result.id as Hex);

  if (txHash) {
    console.log("  ✓ Tx hash:", txHash);
    console.log(`  Explorer: https://sepolia.basescan.org/tx/${txHash}`);
  } else {
    console.log("  ⚠ Tx hash not found in receipt (may still have confirmed)");
  }

  // 6. Log to DB as an autonomous tx record
  console.log("\n📝 Logging to DB...");
  const dbRecord = await logToDb({
    agentId: AGENT_ID,
    calls: [{ to: RECIPIENT, value: AMOUNT.toString(), data: "0x" }],
    description: DESCRIPTION,
    userOpHash: result.id,
    txHash,
  });

  if (dbRecord) {
    console.log("  ✓ Logged! txId:", dbRecord.txId, "| status:", dbRecord.status);
    console.log("  Check the Agent Monitor tab in the webapp to see it.");
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
