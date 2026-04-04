/**
 * requestAuthorisation.ts
 *
 * Agent script that sends a "signature_request" to the webapp and waits
 * for the Ledger owner to approve or reject it. Once approved, the
 * signed UserOp is executed on-chain via the JAW bundler.
 *
 * Flow:
 *   1. Script builds a call (ETH transfer by default, customisable)
 *   2. Posts it to POST /api/agents/:agentId/tx  (type: "signature_request")
 *   3. Polls GET /api/tx/:txId until status is "approved" or "rejected"
 *   4. If approved → executes the calls on-chain with the JAW Account
 *   5. Updates the DB with the resulting txHash
 *
 * Usage:
 *   npx tsx scripts/requestAuthorisation.ts
 *
 * Required env vars (set in .env):
 *   SPENDER_PRIVATE_KEY     - Private key of the agent EOA
 *   PERMISSION_ID           - On-chain permission hash
 *   AGENT_ID                - Agent ID registered in the DB
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Optional:
 *   API_BASE                - Next.js base URL (default: http://localhost:3000)
 *   RECIPIENT               - Destination address (default: vitalik.eth address)
 *   AMOUNT_ETH              - Amount to send in ETH (default: 0.0001)
 *   DESCRIPTION             - Human-readable description shown in webapp
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

// ─── Config ────────────────────────────────────────────────────────────────

const CHAIN_ID         = 84532; // Base Sepolia
const JAW_API_KEY      = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PK       = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID    = process.env.PERMISSION_ID as Hex;
const API_BASE         = process.env.API_BASE ?? "http://localhost:3000";

const RECIPIENT        = (process.env.RECIPIENT ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045") as Address; // vitalik
const AMOUNT_ETH       = process.env.AMOUNT_ETH ?? "0.0001";
const DESCRIPTION      = process.env.DESCRIPTION ?? `Send ${AMOUNT_ETH} ETH to ${RECIPIENT.slice(0, 10)}...`;

// Poll intervals / timeouts
const POLL_INTERVAL_MS = 3_000;
const TIMEOUT_MS       = 5 * 60 * 1_000; // 5 minutes

// ─── Validation ────────────────────────────────────────────────────────────

if (!JAW_API_KEY)   throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PK)    throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Resolve the DB agentId from the permissionId — no manual input needed */
async function resolveAgentId(permissionId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agents?permissionId=${permissionId}`);
  if (res.status === 404) {
    throw new Error(
      `No agent found in DB for permissionId ${permissionId}.\n` +
      `  → Grant the permission via the webapp first (GrantPermission panel).`,
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to resolve agentId: ${err.error ?? res.status}`);
  }
  const data = await res.json();
  return data.agent.agentId as string;
}

type TxStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

interface TxPollResult {
  txId: string;
  status: TxStatus;
  signature: string | null;
  txHash: string | null;
}

/** Poll the webapp API until the tx is no longer pending */
async function pollForDecision(txId: string): Promise<TxPollResult> {
  const deadline = Date.now() + TIMEOUT_MS;

  process.stdout.write("\n⏳ Waiting for user decision");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    process.stdout.write(".");

    const res = await fetch(`${API_BASE}/api/tx/${txId}`);
    if (!res.ok) {
      console.warn(`\n⚠  Poll failed (${res.status}), retrying...`);
      continue;
    }

    const data: TxPollResult = await res.json();
    if (data.status !== "pending") {
      process.stdout.write("\n");
      return data;
    }
  }

  throw new Error(`Timed out after ${TIMEOUT_MS / 1000}s waiting for user decision`);
}

type JawAccount = Awaited<ReturnType<typeof Account.fromLocalAccount>>;

/** Wait for a JAW UserOp to confirm */
async function waitForCalls(
  account: JawAccount,
  id: Hex,
  timeoutMs = 120_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("\n⏳ Confirming on-chain");

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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Agent Authorisation Request        ║");
  console.log("╚══════════════════════════════════════╝\n");

  // 1. Initialise JAW Account
  const spenderLocal = privateKeyToAccount(SPENDER_PK);
  console.log("Agent EOA      :", spenderLocal.address);
  console.log("Permission ID  :", PERMISSION_ID);
  console.log("API            :", API_BASE);

  // Resolve agentId from DB
  console.log("Resolving agentId from DB...");
  const agentId = await resolveAgentId(PERMISSION_ID);
  console.log("Agent ID       :", agentId, "(resolved ✓)");

  const account = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Smart account  :", account.address);

  // 2. Build the call(s) the agent wants to execute
  const amount = parseEther(AMOUNT_ETH);
  const calls = [{ to: RECIPIENT, value: amount, data: "0x" as Hex }];

  console.log("\n─── Requested Action ───────────────────");
  console.log("Description    :", DESCRIPTION);
  console.log("To             :", RECIPIENT);
  console.log("Value          :", AMOUNT_ETH, "ETH");
  console.log("────────────────────────────────────────");

  // 3. Submit signature_request to the webapp DB
  console.log("\n📤 Submitting authorisation request to webapp...");

  const dbCalls = calls.map((c) => ({
    to: c.to,
    value: c.value.toString(),
    data: c.data,
  }));

  const postRes = await fetch(`${API_BASE}/api/agents/${agentId}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "signature_request",
      calls: dbCalls,
      description: DESCRIPTION,
    }),
  });

  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({ error: postRes.statusText }));
    throw new Error(`Failed to submit request: ${err.error ?? postRes.status}`);
  }

  const { txId } = await postRes.json();
  console.log(`✅ Request posted  → txId: ${txId}`);
  console.log(`\n👉 Open the webapp Agent Monitor tab to approve or reject.`);
  console.log(`   ${API_BASE}  (look for the pending request)\n`);

  // 4. Poll until the user decides
  const decision = await pollForDecision(txId);

  if (decision.status === "rejected") {
    console.log("❌ Request was REJECTED by the user. Nothing executed.");
    process.exit(0);
  }

  if (decision.status !== "approved") {
    throw new Error(`Unexpected status: ${decision.status}`);
  }

  console.log("✅ Request APPROVED by user!");

  // 5. Execute on-chain using the JAW permission
  console.log("\n🚀 Executing calls on-chain...");
  console.log("   Permission:", PERMISSION_ID);

  const result = await account.sendCalls(
    calls.map((c) => ({ to: c.to, value: c.value })),
    { permissionId: PERMISSION_ID },
  );

  console.log("   UserOp ID:", result.id);

  // 6. Wait for on-chain confirmation
  const txHash = await waitForCalls(account, result.id as Hex);

  if (txHash) {
    console.log("✅ Confirmed!");
    console.log("   Tx hash :", txHash);
    console.log(`   Explorer: https://sepolia.basescan.org/tx/${txHash}`);
  }

  // 7. Update the DB record with the execution result
  console.log("\n📝 Updating DB with execution result...");
  await fetch(`${API_BASE}/api/tx/${txId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      approved: true,
      txHash: txHash ?? result.id,
    }),
  }).catch((e) => console.warn("  ⚠ DB update failed (non-critical):", e.message));

  console.log("\n✨ Done! The transaction was executed successfully.");
}

main().catch((err) => {
  console.error("\n✗ Error:", err.message ?? err);
  process.exit(1);
});
