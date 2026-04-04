/**
 * Swap ETH → USDC on Base Sepolia via Uniswap V3 SwapRouter02 (plain EOA / private key).
 *
 * Usage:
 *   npx tsx scripts/swapEthToUsdcPrivateKey.ts
 *
 * Environment:
 *   SPENDER_PRIVATE_KEY    - 0x-prefixed EOA private key (funded on Base Sepolia)
 *   BASE_SEPOLIA_RPC_URL   - optional; defaults to https://sepolia.base.org
 *
 * NOTE: The router at 0x94cC0... is SwapRouter02.
 *   - SwapRouter02's ExactInputSingleParams does NOT have a `deadline` field.
 *   - Deadline is passed via the top-level multicall(uint256 deadline, bytes[] data) wrapper.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const rawPk = process.env.SPENDER_PRIVATE_KEY;
if (!rawPk) throw new Error("SPENDER_PRIVATE_KEY not set");

const PRIVATE_KEY = (
  rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`
) as Hex;

// Uniswap V3 SwapRouter02 on Base Sepolia
const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const FEE = 3000; // 0.3% — adjust to 500 if pool doesn't exist
const SWAP_AMOUNT = parseEther("0.0001"); // 0.0001 ETH

// SwapRouter02 ABI — ExactInputSingleParams has NO `deadline` field.
// Deadline is enforced via the multicall wrapper below.
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

// SwapRouter02 multicall overload that accepts a deadline
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

async function main() {
  console.log("=== Swap ETH → USDC (Base Sepolia, EOA, SwapRouter02) ===\n");

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("EOA:", account.address);
  console.log("RPC:", RPC_URL);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("ETH balance:", balance.toString(), "wei");

  if (balance < SWAP_AMOUNT) {
    throw new Error(
      `Insufficient ETH balance. Have ${balance} wei, need ${SWAP_AMOUNT} wei.`
    );
  }

  // Deadline: 10 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // 1. Encode the inner exactInputSingle call (no deadline in struct)
  const innerCalldata = encodeFunctionData({
    abi: exactInputSingleAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn:          WETH,
        tokenOut:         USDC,
        fee:              FEE,
        recipient:        account.address,
        amountIn:         SWAP_AMOUNT,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  // 2. Wrap in multicall(deadline, [innerCalldata]) so the router enforces the deadline
  const outerCalldata = encodeFunctionData({
    abi: multicallAbi,
    functionName: "multicall",
    args: [deadline, [innerCalldata]],
  });

  console.log("\nSimulating swap…");
  await publicClient.call({
    account: account.address,
    to: SWAP_ROUTER,
    data: outerCalldata,
    value: SWAP_AMOUNT,
  });
  console.log("Simulation OK");

  console.log("\nSubmitting swap (0.0001 ETH → USDC)…");
  const hash = await walletClient.sendTransaction({
    to: SWAP_ROUTER,
    data: outerCalldata,
    value: SWAP_AMOUNT,
  });

  console.log("Tx hash:", hash);
  console.log(`Explorer: https://sepolia.basescan.org/tx/${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status);
  if (receipt.status === "reverted") {
    throw new Error("Transaction was reverted on-chain. Check the explorer for details.");
  }
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
