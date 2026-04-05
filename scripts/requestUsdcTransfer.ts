/**
 * Request user authorisation before transferring USDC on Base Sepolia.
 *
 * This script acts as the SPENDER — it first posts a "signature_request" to
 * the webapp so the account owner can approve or reject it from the Agent
 * Monitor UI. If approved, the script executes the USDC transfer on-chain
 * via the JAW permission system.
 *
 * ── Grant Permission fields (webapp → GrantPermission panel) ───────────────
 *
 *   Agent wallet address  →  <spender smart account address>
 *   Permission duration   →  e.g. 24 hours
 *
 *   Call Restrictions:
 *     Target contract     →  0x036CbD53842c5426634e7929541eC2318f3dCF7e  (Custom, USDC Base Sepolia)
 *     Function selector   →  0xa9059cbb                                   (Custom, transfer(address,uint256))
 *
 *   Spend Limit:
 *     Token               →  Custom Token → 0x036CbD53842c5426634e7929541eC2318f3dCF7e  (USDC)
 *     Amount              →  e.g. 100  (in USDC, human-readable)
 *     Period              →  day | week | month | forever
 *
 * ── Flow ─────────────────────────────────────────────────────────────────────
 *   1. Script builds an ERC-20 transfer call
 *   2. Posts it to POST /api/agents/:agentId/tx  (type: "signature_request")
 *   3. Polls GET /api/tx/:txId until status is "approved" or "rejected"
 *   4. If approved → executes the USDC transfer on-chain with the JAW Account
 *   5. Updates the DB with the resulting txHash
 *
 * Usage:
 *   npx tsx scripts/requestUsdcTransfer.ts
 *
 * Required env vars (set in .env):
 *   SPENDER_PRIVATE_KEY     - Private key of the agent EOA
 *   PERMISSION_ID           - On-chain permission hash
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Optional:
 *   API_BASE                - Next.js base URL (default: http://localhost:3000)
 *   USDC_RECIPIENT          - Destination address (default: dev placeholder)
 *   USDC_AMOUNT             - Amount in USDC, human-readable (default: 1)
 *   DESCRIPTION             - Human-readable description shown in webapp
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi, parseUnits, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const CHAIN_ID         = 84532; // Base Sepolia
const JAW_API_KEY      = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PK       = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID    = process.env.PERMISSION_ID as Hex;
const API_BASE         = process.env.API_BASE ?? "http://localhost:3000";

// USDC on Base Sepolia — https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
const USDC_ADDRESS  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const RECIPIENT     = (process.env.USDC_RECIPIENT ?? "0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e") as Address;
const AMOUNT_USDC   = process.env.USDC_AMOUNT ?? "1"; // human-readable USDC (6 decimals)
const DESCRIPTION   = process.env.DESCRIPTION
  ?? `Transfer ${AMOUNT_USDC} USDC to ${RECIPIENT.slice(0, 10)}... (agent-requested)`;

// Poll intervals / timeouts
const POLL_INTERVAL_MS = 3_000;
const TIMEOUT_MS       = 5 * 60 * 1_000; // 5 minutes

// ─── Validation ──────────────────────────────────────────────────────────────

if (!JAW_API_KEY)   throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PK)    throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

// ─── Types ───────────────────────────────────────────────────────────────────

type JawAccount = Awaited<ReturnType<typeof Account.fromLocalAccount>>;
type TxStatus   = "pending" | "approved" | "rejected" | "executed" | "failed";

interface TxPollResult {
  txId: string;
  status: TxStatus;
  signature: string | null;
  txHash: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   USDC Transfer Authorisation Request    ║");
  console.log("╚══════════════════════════════════════════╝\n");

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

  // 2. Encode the ERC-20 transfer call
  //    Per JAW SDK rules: MUST use encodeFunctionData — do NOT pass raw value.
  const atomicAmount = parseUnits(AMOUNT_USDC, 6); // USDC has 6 decimals
  const transferData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [RECIPIENT, atomicAmount],
  });

  const calls = [{ to: USDC_ADDRESS, data: transferData }];

  console.log("\n─── Requested Action ───────────────────────");
  console.log("Description    :", DESCRIPTION);
  console.log("USDC contract  :", USDC_ADDRESS);
  console.log("Function       : transfer(address,uint256)");
  console.log("Recipient      :", RECIPIENT);
  console.log("Amount         :", AMOUNT_USDC, "USDC (", atomicAmount.toString(), "units)");
  console.log("────────────────────────────────────────────");

  // 3. Submit signature_request to the webapp DB
  console.log("\n📤 Submitting authorisation request to webapp...");

  const dbCalls = calls.map((c) => ({
    to: c.to,
    value: "0",
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
  console.log("\n🚀 Executing USDC transfer on-chain...");
  console.log("   Permission:", PERMISSION_ID);

  const result = await account.sendCalls(calls, { permissionId: PERMISSION_ID });
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

  console.log("\n✨ Done! USDC transfer was executed successfully.");
}

main().catch((err) => {
  console.error("\n✗ Error:", err.message ?? err);
  process.exit(1);
});
