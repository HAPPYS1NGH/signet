/**
 * exceedLimitRequest.ts
 *
 * Simulates an agent that wants to execute a transaction ABOVE its autonomous
 * spend limit — so it cannot self-execute. Instead it escalates to the human
 * owner by posting a signature_request to the webapp.
 *
 * Flow:
 *   1. Agent detects the requested amount exceeds its permission limit
 *   2. Posts a "signature_request" to POST /api/agents/:agentId/tx
 *   3. Owner sees a pending approval card in the webapp Agent Monitor tab
 *   4. Owner clicks "Approve & Sign on Ledger" → Ledger signs the UserOp
 *   5. Webapp submits it on-chain and writes txHash back to DB
 *   6. This script polls GET /api/tx/:txId until txHash appears, then exits
 *
 * The agent script NEVER touches the private key of the owner.
 * All signing happens on the owner's physical Ledger device in the webapp.
 *
 * Usage:
 *   npx tsx scripts/exceedLimitRequest.ts
 *
 * Required env vars (in .env):
 *   SPENDER_PRIVATE_KEY     - Agent's EOA private key
 *   PERMISSION_ID           - On-chain permission hash
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Optional:
 *   API_BASE                - Base URL of the webapp (default: http://localhost:3000)
 *   RECIPIENT               - Target address for the transfer
 *   AMOUNT_ETH              - Amount to send — set this ABOVE the permission spend limit
 */

import { privateKeyToAccount } from "viem/accounts";
import { parseEther, formatEther, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

// ─── Config ────────────────────────────────────────────────────────────────

const JAW_API_KEY      = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PK       = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID    = process.env.PERMISSION_ID as Hex;
const API_BASE         = process.env.API_BASE ?? "http://localhost:3000";

// The smart account address (EIP-7702 account that owns the permission)
const SMART_ACCOUNT    = (process.env.SMART_ACCOUNT ?? "0xCC2c2DEeb1327Ecd6d98EB052414132F136092f6") as Address;

// The call the agent wants to make — must match what's in the permission's call spec
// target + selector from the granted permission
const CALL_TARGET      = (process.env.CALL_TARGET   ?? "0x3232323232323232323232323232323232323232") as Address;
const CALL_SELECTOR    = (process.env.CALL_SELECTOR  ?? "0xe0e0e0e0") as Hex;

// Amount EXCEEDS the agent's autonomous spend limit — that's why it needs approval
const AMOUNT_ETH       = process.env.AMOUNT_ETH ?? "0.05"; // above the 0.01 ETH/day limit

// Poll config
const POLL_INTERVAL_MS = 3_000;
const TIMEOUT_MS       = 10 * 60 * 1_000; // 10 minutes — user needs time to sign

// ─── Validation ────────────────────────────────────────────────────────────

if (!JAW_API_KEY)   throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PK)    throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Resolve the DB agentId from the permissionId — no manual input needed */
async function resolveAgent(permissionId: string): Promise<{ agentId: string; permissionEnd: number; spendLimit: string }> {
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
  const { agent } = await res.json();

  // Extract the first spend limit for display purposes
  const firstSpend = agent.permission?.spends?.[0];
  const spendLimitWei = firstSpend?.allowance ?? "0";
  const spendLimit = spendLimitWei !== "0"
    ? `${formatEther(BigInt(spendLimitWei))} ETH / ${firstSpend?.unit ?? "period"}`
    : "no spend limit recorded";

  return {
    agentId: agent.agentId as string,
    permissionEnd: agent.permission?.end ?? 0,
    spendLimit,
  };
}

type TxStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

interface TxRecord {
  txId: string;
  status: TxStatus;
  signature: string | null;
  txHash: string | null;
}

/** Poll the DB until the tx is resolved (approved/rejected) AND txHash is populated */
async function pollUntilExecuted(txId: string): Promise<TxRecord> {
  const deadline = Date.now() + TIMEOUT_MS;

  process.stdout.write("\n⏳ Waiting for owner approval on Ledger");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    process.stdout.write(".");

    let record: TxRecord;
    try {
      const res = await fetch(`${API_BASE}/api/tx/${txId}`);
      if (!res.ok) continue;
      record = await res.json();
    } catch {
      continue; // network blip, retry
    }

    if (record.status === "rejected") {
      process.stdout.write("\n");
      return record;
    }

    // Approved + txHash means it was actually executed on-chain by the webapp
    if (record.status === "approved" && record.txHash) {
      process.stdout.write("\n");
      return record;
    }

    // Approved but no txHash yet — still waiting for the on-chain confirmation
    if (record.status === "approved") {
      process.stdout.write("🔄"); // show different char while confirming on-chain
    }
  }

  throw new Error(
    `Timed out after ${TIMEOUT_MS / 1000}s.\n` +
    `The request may still be pending — check the webapp Agent Monitor tab.`,
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Agent — Over-Limit Approval Request    ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const spenderLocal = privateKeyToAccount(SPENDER_PK);
  const amount = parseEther(AMOUNT_ETH);

  console.log("Agent EOA     :", spenderLocal.address);
  console.log("Permission ID :", PERMISSION_ID);
  console.log("API           :", API_BASE);

  // Resolve agentId + permission details from DB
  console.log("\nResolving agent from DB...");
  const { agentId, permissionEnd, spendLimit } = await resolveAgent(PERMISSION_ID);
  console.log("Agent ID      :", agentId, "(resolved ✓)");
  if (permissionEnd > 0) {
    const expiresAt = new Date(permissionEnd * 1000).toLocaleString();
    console.log("Permission exp:", expiresAt);
  }
  console.log("Spend limit   :", spendLimit);

  // Show why this needs approval
  console.log("\n─────────────────────────────────────────────");
  console.log("  ⚠  EXCEEDS AUTONOMOUS LIMIT");
  console.log(`  Requested : ${AMOUNT_ETH} ETH  →  ${CALL_TARGET.slice(0, 14)}...`);
  console.log("  Reason    : Amount is above the agent's permission spend limit.");
  console.log("  Action    : Escalating to owner for manual Ledger approval.");
  console.log("─────────────────────────────────────────────");

  // Build the description shown in the webapp approval card
  const description =
    `⚠ Over-limit transfer: ${AMOUNT_ETH} ETH → ${CALL_TARGET.slice(0, 14)}... ` +
    `(exceeds autonomous spend limit of ${spendLimit})`;

  // Post the signature_request to the DB
  console.log("\n📤 Posting approval request to webapp...");
  const postRes = await fetch(`${API_BASE}/api/agents/${agentId}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "signature_request",
      calls: [
        {
          to: CALL_TARGET,
          value: amount.toString(),
          data: CALL_SELECTOR,
        },
      ],
      description,
    }),
  });

  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({ error: postRes.statusText }));
    throw new Error(`Failed to post request: ${err.error ?? postRes.status}`);
  }

  const { txId } = await postRes.json();

  console.log(`\n✅ Request posted!`);
  console.log(`   txId  : ${txId}`);
  console.log(`\n👉 Open the webapp and go to the Agent Monitor tab:`);
  console.log(`   ${API_BASE}`);
  console.log(`   You will see a pending approval card — click "Approve & Sign on Ledger"\n`);

  // Poll until owner approves/rejects and the tx executes
  const result = await pollUntilExecuted(txId);

  // Handle outcomes
  if (result.status === "rejected") {
    console.log("\n❌ Rejected by owner. No transaction was executed.");
    console.log("   The agent will not retry this request.");
    process.exit(0);
  }

  if (result.status === "approved" && result.txHash) {
    console.log("\n✅ Approved and executed on-chain!");
    console.log("   Tx hash :", result.txHash);
    console.log(`   Explorer: https://sepolia.basescan.org/tx/${result.txHash}`);
    console.log("\n✨ Done — the over-limit transfer was signed on the owner's Ledger.");
    process.exit(0);
  }

  // Shouldn't reach here
  console.log("\n⚠  Unexpected final status:", result.status);
  process.exit(1);
}

main().catch((err) => {
  console.error("\n✗ Error:", err.message ?? err);
  process.exit(1);
});
