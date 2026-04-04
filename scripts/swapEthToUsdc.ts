/**
 * Swap ETH → USDC on Base Sepolia via Uniswap V3 SwapRouter02.
 *
 * Usage:
 *   npx tsx scripts/swapEthToUsdc.ts
 *
 * Environment variables:
 *   SPENDER_PRIVATE_KEY     - Agent's private key
 *   PERMISSION_ID           - On-chain permission hash
 *   AGENT_ID                - Agent ID from our DB
 *   NEXT_PUBLIC_JAW_API_KEY - JAW API key
 *
 * Permission needed when granting:
 *   Target:   0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4  (Uniswap V3 SwapRouter02, Base Sepolia)
 *   Selector: 0xac9650d8                                   (multicall(uint256,bytes[]))
 *   Spend:    Native ETH, whatever limit you want
 *
 * NOTE: The router is SwapRouter02.
 *   - SwapRouter02's ExactInputSingleParams does NOT have a `deadline` field.
 *   - Deadline is passed via the top-level multicall(uint256 deadline, bytes[] data) wrapper.
 *
 * HOW THE SWAP WORKS (2-phase):
 *   The JAW permission executor calls the smart account's execute() with value=0,
 *   so it cannot forward native ETH to the SwapRouter. We route around this by:
 *
 *   Phase 1 (normal sendCalls, no permissionId — user-signed):
 *     a) WETH.deposit()                        — wrap ETH → WETH
 *     b) WETH.approve(SwapRouter, SWAP_AMOUNT)  — let SwapRouter pull WETH
 *
 *   Phase 2 (permissioned sendCalls — no ETH value needed):
 *     a) SwapRouter.multicall(deadline, [exactInputSingle(WETH→USDC)])
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import {
  parseEther,
  encodeFunctionData,
  erc20Abi,
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
const AGENT_ID = process.env.AGENT_ID!;
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

// Uniswap V3 SwapRouter02 on Base Sepolia
const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address;
// WETH on Base Sepolia
const WETH = "0x4200000000000000000000000000000000000006" as Address;
// USDC on Base Sepolia
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
// Pool fee tier (0.3%) — change to 500 if the pool doesn't exist
const FEE = 3000;
// Amount to swap
const SWAP_AMOUNT = parseEther("0.0001"); // 0.0001 ETH / WETH

if (!JAW_API_KEY) throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
if (!SPENDER_PRIVATE_KEY) throw new Error("SPENDER_PRIVATE_KEY not set");
if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

// WETH deposit ABI — wraps native ETH into WETH
const wethAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

// SwapRouter02 exactInputSingle ABI — NO `deadline` in the struct (removed in SwapRouter02)
const exactInputSingleAbi = [
  {
    inputs: [
      {
        components: [
          { name: "tokenIn",           type: "address" },
          { name: "tokenOut",          type: "address" },
          { name: "fee",               type: "uint24"  },
          { name: "recipient",         type: "address" },
          { name: "amountIn",          type: "uint256" },
          { name: "amountOutMinimum",  type: "uint256" },
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

// SwapRouter02 multicall overload that accepts a top-level deadline
const multicallAbi = [
  {
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data",     type: "bytes[]" },
    ],
    name: "multicall",
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

/** Poll getCallStatus until completed / failed / timeout */
async function waitForCalls(
  account: Awaited<ReturnType<typeof Account.fromLocalAccount>>,
  id: Hex,
  label: string,
): Promise<string | null> {
  console.log(`\nPolling "${label}"...`);
  for (let i = 0; i < 40; i++) {
    const status = account.getCallStatus(id);
    if (status) {
      console.log(`  Status: ${status.status}`);
      if (status.status === 200) {
        // Completed
        const txHash = status.receipts?.[0]?.transactionHash ?? null;
        if (txHash) {
          console.log(`  Tx hash: ${txHash}`);
          console.log(`  Explorer: https://sepolia.basescan.org/tx/${txHash}`);
        }
        return txHash;
      }
      if (status.status === 400 || status.status === 500) {
        throw new Error(`"${label}" failed with status ${status.status}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`"${label}" timed out after 80 seconds`);
}

async function main() {
  console.log("=== Swap ETH → USDC (Base Sepolia, 2-phase via JAW) ===\n");

  // 1. Create spender account
  const spenderLocal = privateKeyToAccount(
    `0x${SPENDER_PRIVATE_KEY.replace(/^0x/, "")}`,
  );
  console.log("Spender EOA:", spenderLocal.address);

  const account = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: JAW_API_KEY },
    spenderLocal,
  );
  console.log("Smart account:", account.address);

  // ─── Phase 1: Wrap ETH → WETH + Approve SwapRouter ───────────────────────
  // Normal batch call (no permissionId). The JAW permission executor cannot
  // forward native ETH value, so we wrap first and approve the router.
  console.log("\n── Phase 1: Wrap ETH → WETH + Approve SwapRouter ──");

  const wrapCalldata = encodeFunctionData({
    abi: wethAbi,
    functionName: "deposit",
  });

  const approveCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [SWAP_ROUTER, SWAP_AMOUNT],
  });

  const phase1Result = await account.sendCalls([
    {
      to: WETH,
      value: SWAP_AMOUNT, // sends ETH to WETH contract, which mints WETH 1:1
      data: wrapCalldata,
    },
    {
      to: WETH,
      data: approveCalldata, // allows SwapRouter to pull WETH from the smart account
    },
  ]);
  console.log("Phase 1 UserOp ID:", phase1Result.id);
  await waitForCalls(account, phase1Result.id as Hex, "Wrap + Approve");

  // ─── Phase 2: Swap WETH → USDC (permissioned) ────────────────────────────
  // No ETH value — SwapRouter pulls WETH as an ERC-20 using the approval above.
  console.log("\n── Phase 2: Swap WETH → USDC (permissioned) ──");

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min

  // Inner: exactInputSingle with WETH as ERC-20 tokenIn
  const innerCalldata = encodeFunctionData({
    abi: exactInputSingleAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn:           WETH,
        tokenOut:          USDC,
        fee:               FEE,
        recipient:         account.address,
        amountIn:          SWAP_AMOUNT,
        amountOutMinimum:  0n, // no slippage protection for test
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  // Outer: multicall(deadline, [innerCalldata]) — deadline enforcement for SwapRouter02
  const swapCalldata = encodeFunctionData({
    abi: multicallAbi,
    functionName: "multicall",
    args: [deadline, [innerCalldata]],
  });

  console.log("  Router:", SWAP_ROUTER);
  console.log("  Amount: 0.0001 WETH → USDC");
  console.log("  Recipient:", account.address);
  console.log("  Deadline:", new Date(Number(deadline) * 1000).toISOString());
  console.log("  Permission:", PERMISSION_ID);
  console.log("  Calldata:", swapCalldata.slice(0, 20) + "...");

  const phase2Result = await account.sendCalls(
    [
      {
        to: SWAP_ROUTER,
        data: swapCalldata,
        // no value — SwapRouter pulls WETH via the ERC-20 approval from Phase 1
      },
    ],
    { permissionId: PERMISSION_ID },
  );
  console.log("Phase 2 UserOp ID:", phase2Result.id);
  const txHash = await waitForCalls(account, phase2Result.id as Hex, "WETH→USDC Swap");

  // ─── Log to agent API ─────────────────────────────────────────────────────
  if (AGENT_ID) {
    console.log("\nLogging to agent API...");
    const logRes = await fetch(`${API_BASE}/api/agents/${AGENT_ID}/tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "autonomous",
        calls: [
          {
            to: SWAP_ROUTER,
            value: "0",
            data: swapCalldata,
          },
        ],
        description: "Swapped 0.0001 ETH → USDC via Uniswap V3 (WETH ERC-20 route)",
        userOpHash: phase2Result.id,
        txHash,
      }),
    });
    const logData = await logRes.json();
    console.log("  API response:", JSON.stringify(logData));
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
