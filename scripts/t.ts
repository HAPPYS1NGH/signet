/**
 * Swap ETH → USDC using ERC-7702 permission (JAW smart account)
 *
 * Usage:
 *   npx tsx scripts/swapEthToUsdcWithPermission.ts
 *
 * Environment:
 *   SPENDER_PRIVATE_KEY
 *   PERMISSION_ID
 *   NEXT_PUBLIC_JAW_API_KEY
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import {
  parseEther,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
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

// --- Uniswap Config ---
const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const FEE = 3000;
const SWAP_AMOUNT = parseEther("0.0001");

// --- ABIs ---
const exactInputSingleAbi = [
  {
    inputs: [
      {
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactInputSingle",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

const multicallAbi = [
  {
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    name: "multicall",
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

async function main() {
  console.log("=== Swap ETH → USDC (ERC-7702 Permission) ===\n");

  // 1. Spender EOA
  const spenderLocal = privateKeyToAccount(SPENDER_PRIVATE_KEY);
  console.log("Spender EOA:", spenderLocal.address);

  // 2. Wrap into JAW smart account
  const spenderAccount = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );

  console.log("Smart Account:", spenderAccount.address);

  // 3. Deadline
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // 4. Encode inner swap
  const innerCalldata = encodeFunctionData({
    abi: exactInputSingleAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: USDC,
        fee: FEE,
        recipient: spenderAccount.address,
        amountIn: SWAP_AMOUNT,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  // 5. Wrap in multicall
  const outerCalldata = encodeFunctionData({
    abi: multicallAbi,
    functionName: "multicall",
    args: [deadline, [innerCalldata]],
  });

  // 6. Prepare call
  const calls = [
    {
      to: SWAP_ROUTER,
      data: outerCalldata,
      value: SWAP_AMOUNT,
    },
  ];

  console.log("\nExecuting swap with permission:", PERMISSION_ID);

  // 7. Execute via ERC-7702 permission
  const result = await spenderAccount.sendCalls(calls, {
    permissionId: PERMISSION_ID,
  });

  console.log("\nUserOp submitted!");
  console.log("ID:", result.id);
  console.log(`Explorer: https://sepolia.basescan.org/tx/${result.id}`);

  // 8. Poll for receipt
  console.log("\nPolling for status...");
  for (let i = 0; i < 30; i++) {
    const status = await spenderAccount.getCallStatus(result.id);

    if (status) {
      console.log("Status:", status.status);

      if (status.receipts?.length) {
        const txHash = status.receipts[0].transactionHash;
        console.log("Tx hash:", txHash);
        console.log(
          `Explorer: https://sepolia.basescan.org/tx/${txHash}`,
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