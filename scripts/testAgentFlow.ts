/**
 * Test the full agent flow:
 * 1. Execute a small ETH transfer using @jaw.id/core with permission
 * 2. Log the tx to our API as "autonomous"
 *
 * Usage:
 *   npx tsx scripts/testAgentFlow.ts
 *
 * Environment variables:
 *   SPENDER_PRIVATE_KEY     - Private key of the agent (spender)
 *   PERMISSION_ID           - On-chain permission hash
 *   AGENT_ID                - Agent ID from our DB (from grant permission step)
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Permission to grant (simplest possible):
 *   No Call Permission needed for plain ETH transfers.
 *   Spend Limit: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE (native ETH), e.g. 0.001 ETH / Day
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
const AGENT_ID = process.env.AGENT_ID!;
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

if (!JAW_API_KEY) throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PRIVATE_KEY) throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");
if (!AGENT_ID) throw new Error("AGENT_ID not set");

type JawAccount = Awaited<ReturnType<typeof Account.fromLocalAccount>>;

/** Poll getCallStatus until the UserOp is confirmed, failed, or timed out */
async function waitForCalls(
  account: JawAccount,
  id: Hex,
  timeoutMs = 120_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = account.getCallStatus(id);
    if (status) {
      const s = status.status;
      if (s === 200) return status.receipts?.[0]?.transactionHash ?? null; // Completed
      if (s === 400 || s === 500) throw new Error(`UserOp failed with status ${s}`);
      // 100 = Pending — keep polling
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for UserOp confirmation (120s)");
}

async function main() {
  console.log("=== Test Agent Flow ===\n");

  // 1. Create spender account
  const spenderLocal = privateKeyToAccount(`0x${SPENDER_PRIVATE_KEY.replace(/^0x/, "")}`);
  console.log("Spender EOA:", spenderLocal.address);

  const account = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Smart account:", account.address);

  // 2. Execute a tiny autonomous transfer
  const RECIPIENT = "0x000000000000000000000000000000000000dEaD" as Address;
  const amount = parseEther("0.0001");
  const calls = [{ to: RECIPIENT, value: amount }];

  console.log("\nExecuting autonomous transfer...");
  console.log("  To:", RECIPIENT);
  console.log("  Amount: 0.0001 ETH");
  console.log("  Permission:", PERMISSION_ID);

  const result = await account.sendCalls(calls, {
    permissionId: PERMISSION_ID,
  });

  console.log("\nUserOp submitted!");
  console.log("  ID:", result.id);

  // 3. Poll for confirmation
  console.log("\nWaiting for confirmation...");
  const txHash = await waitForCalls(account, result.id as Hex);
  if (txHash) {
    console.log("  ✓ Tx hash:", txHash);
    console.log(`  Explorer: https://sepolia.basescan.org/tx/${txHash}`);
  }

  // 4. Log to our agent API
  console.log("\nLogging to agent API...");
  const logRes = await fetch(`${API_BASE}/api/agents/${AGENT_ID}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "autonomous",
      calls: [{ to: RECIPIENT, value: amount.toString(), data: "0x" }],
      description: "Sent 0.0001 ETH to 0xdead (agentic transfer demo)",
      userOpHash: result.id,
      txHash,
    }),
  });

  const logData = await logRes.json();
  console.log("  API response:", JSON.stringify(logData));

  console.log("\nDone! Check the webapp Agent Activity panel.");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
