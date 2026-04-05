/**
 * Transfer USDC on Base Sepolia using a granted permission.
 *
 * This script acts as the SPENDER — it uses a permission previously granted
 * by the account owner to call `transfer(address,uint256)` on the USDC
 * contract autonomously, without requiring user interaction.
 *
 * After execution it logs the tx to our DB as an "autonomous" record.
 * The agentId is auto-resolved from the DB using PERMISSION_ID.
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
 * Usage:
 *   npx tsx scripts/transferUsdc.ts
 *
 * Environment variables:
 *   SPENDER_PRIVATE_KEY     - Private key of the spender (who was granted the permission)
 *   PERMISSION_ID           - The permissionId returned from grantPermissions
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Optional:
 *   API_BASE                - Next.js base URL (default: http://localhost:3000)
 *   USDC_RECIPIENT          - Destination address (default: dev placeholder)
 *   USDC_AMOUNT             - Amount in USDC, human-readable (default: 1)
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi, parseUnits, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const CHAIN_ID            = 84532; // Base Sepolia
const JAW_API_KEY         = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PRIVATE_KEY = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID       = process.env.PERMISSION_ID as Hex;
const API_BASE            = process.env.API_BASE ?? "http://localhost:3000";

// USDC on Base Sepolia — https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const RECIPIENT   = (process.env.USDC_RECIPIENT ?? "0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e") as Address;
const AMOUNT_USDC = process.env.USDC_AMOUNT ?? "1"; // human-readable USDC (6 decimals)

// ─── Validation ──────────────────────────────────────────────────────────────

if (!JAW_API_KEY)         throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PRIVATE_KEY) throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID)       throw new Error("PERMISSION_ID not set");

// ─── Types ───────────────────────────────────────────────────────────────────

type JawAccount = Awaited<ReturnType<typeof Account.fromLocalAccount>>;

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

/** Poll getCallStatus until the UserOp is confirmed, failed, or timed out */
async function waitForCalls(
  account: JawAccount,
  id: Hex,
  timeoutMs = 120_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("\n⏳ Waiting for confirmation");

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Autonomous USDC Transfer           ║");
  console.log("╚══════════════════════════════════════╝\n");

  // 1. Create the spender's local account from private key
  const spenderLocal = privateKeyToAccount(SPENDER_PRIVATE_KEY);
  console.log("Spender EOA   :", spenderLocal.address);
  console.log("Permission ID :", PERMISSION_ID);
  console.log("USDC contract :", USDC_ADDRESS);
  console.log("Recipient     :", RECIPIENT);
  console.log("Amount        :", AMOUNT_USDC, "USDC");

  // 2. Auto-resolve agentId from DB using permissionId
  console.log("\nResolving agentId from DB...");
  const agentId = await resolveAgentId(PERMISSION_ID);
  console.log("Agent ID      :", agentId, "(resolved from DB ✓)");

  // 3. Create JAW Account from the spender's local account
  const spenderAccount = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Smart account :", spenderAccount.address);

  // 4. Encode the ERC-20 transfer call
  //    Per JAW SDK rules: MUST use encodeFunctionData — do NOT pass raw value.
  const atomicAmount = parseUnits(AMOUNT_USDC, 6); // USDC has 6 decimals
  const transferData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [RECIPIENT, atomicAmount],
  });

  const calls = [{ to: USDC_ADDRESS, data: transferData }];

  const description = `Autonomous USDC transfer: ${AMOUNT_USDC} USDC → ${RECIPIENT.slice(0, 10)}...`;

  console.log("\n─── Call ───────────────────────────────");
  console.log("Target        :", USDC_ADDRESS, "(USDC)");
  console.log("Function      : transfer(address,uint256)");
  console.log("Recipient     :", RECIPIENT);
  console.log("Amount        :", AMOUNT_USDC, "USDC (", atomicAmount.toString(), "units)");
  console.log("────────────────────────────────────────");

  // 5. Send calls using the permission
  console.log("\n🚀 Submitting UserOp...");
  const result = await spenderAccount.sendCalls(calls, {
    permissionId: PERMISSION_ID,
  });
  console.log("  UserOp ID:", result.id);

  // 6. Wait for on-chain confirmation
  const txHash = await waitForCalls(spenderAccount, result.id as Hex);

  if (txHash) {
    console.log("✅ Confirmed!");
    console.log("  Tx hash :", txHash);
    console.log(`  Explorer: https://sepolia.basescan.org/tx/${txHash}`);
  } else {
    console.log("  ⚠ Tx hash not found in receipt (may still have confirmed)");
  }

  // 7. Log to DB as autonomous tx record
  console.log("\n📝 Logging to DB...");
  const dbRecord = await logToDb({
    agentId,
    calls: [{ to: USDC_ADDRESS, value: "0", data: transferData }],
    description,
    userOpHash: result.id,
    txHash,
  });

  if (dbRecord) {
    console.log("  ✓ Logged! txId:", dbRecord.txId, "| status:", dbRecord.status);
    console.log("  Visible in Agent Monitor tab on the webapp.");
  }

  console.log("\n✨ Done!");
}

main().catch((err) => {
  console.error("\n✗ Error:", err.message ?? err);
  process.exit(1);
});
