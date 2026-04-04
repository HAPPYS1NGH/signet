/**
 * Execute calls using a granted permission.
 *
 * This script acts as the SPENDER — it uses a permission previously granted
 * by the Ledger smart account owner to execute calls on behalf of the account.
 *
 * Usage:
 *   npx tsx scripts/executeWithPermission.ts
 *
 * Environment variables:
 *   SPENDER_PRIVATE_KEY  - Private key of the spender (who was granted the permission)
 *   PERMISSION_ID        - The permissionId returned from grantPermissions
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, encodeFunctionData, type Address, type Hex } from "viem";
import dotenv from "dotenv";

dotenv.config();

// --- Config ---
const CHAIN_ID = 84532; // Base Sepolia
const JAW_API_KEY = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PRIVATE_KEY = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID = process.env.PERMISSION_ID as Hex;

if (!JAW_API_KEY) throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PRIVATE_KEY) throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

async function main() {
  console.log("=== Execute With Permission ===\n");

  // 1. Create the spender's local account from private key
  const spenderLocal = privateKeyToAccount(SPENDER_PRIVATE_KEY);
  console.log("Spender EOA:", spenderLocal.address);

  // 2. Create JAW Account from the spender's local account
  //    This wraps the spender EOA into a smart account
  const spenderAccount = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Spender smart account:", spenderAccount.address);

  // 3. Define the calls to execute using the permission
  //    Example: send 0.0001 ETH to a recipient
  const RECIPIENT = "0x000000000000000000000000000000000000dEaD" as Address;
  const calls = [
    {
      to: RECIPIENT,
      value: parseEther("0.0001"),
    },
  ];

  console.log("\nExecuting with permission:", PERMISSION_ID);
  console.log("Calls:", calls.map((c) => `${c.to} ${c.value} wei`));

  // 4. Send calls using the permission
  //    The PermissionsManager validates that:
  //    - The permission is active (start <= now < end)
  //    - The spender matches
  //    - The calls are within the allowed targets/selectors
  //    - Spend limits are not exceeded
  const result = await spenderAccount.sendCalls(calls, {
    permissionId: PERMISSION_ID,
  });

  console.log("\nUserOp submitted!");
  console.log("  ID:", result.id);
  console.log("  Chain:", result.chainId);
  console.log(
    `  Explorer: https://sepolia.basescan.org/tx/${result.id}`,
  );

  // 5. Optionally poll for status
  console.log("\nPolling for status...");
  for (let i = 0; i < 30; i++) {
    const status = spenderAccount.getCallStatus(result.id);
    if (status) {
      console.log("  Status:", status.status);
      if (status.receipts?.length) {
        console.log(
          "  Tx hash:",
          status.receipts[0].transactionHash,
        );
        console.log(
          `  Explorer: https://sepolia.basescan.org/tx/${status.receipts[0].transactionHash}`,
        );
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
