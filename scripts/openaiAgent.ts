/**
 * Natural-language agent: OpenAI parses intent, then either executes with
 * permission (autonomous) or posts a signature_request when over the DB
 * spend hint — same flows as executeWithPermission.ts / exceedLimitRequest.ts.
 *
 * Usage:
 *   npx tsx scripts/openaiAgent.ts "Send 0.0001 ETH to 0x..."
 *   npx tsx scripts/openaiAgent.ts   # reads one line from stdin
 *
 * Env:
 *   OPEN_AI_API_KEY or OPENAI_API_KEY
 *   SPENDER_PRIVATE_KEY, PERMISSION_ID, NEXT_PUBLIC_JAW_API_KEY
 *   API_BASE (optional, default http://localhost:3000)
 */

import OpenAI from "openai";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import dotenv from "dotenv";

import {
  resolveAgent,
  withinDbNativeSpendHint,
  runEthTransfer,
  runSwapEthToUsdc,
  printAgentContext,
} from "./lib/permissionAgentRunner";

dotenv.config();

const OPENAI_KEY =
  process.env.OPEN_AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const JAW_API_KEY = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PK = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID = process.env.PERMISSION_ID as Hex;
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

type ParsedIntent =
  | {
      intent: "transfer_eth";
      recipient: Address;
      amount_eth: string;
      reasoning: string;
    }
  | { intent: "swap_eth_to_usdc"; reasoning: string }
  | { intent: "clarify"; message: string }
  | { intent: "unsupported"; message: string };

const SYSTEM = `You are a routing assistant for a blockchain agent on Base Sepolia (chain 84532).
The user speaks in plain language. You output ONLY valid JSON, no markdown.

Classify the request into one of:
1) transfer_eth — user wants to send native ETH to an address. You MUST extract:
   - recipient: checksummed 0x address
   - amount_eth: decimal string e.g. "0.0001" (ETH, not wei)
2) swap_eth_to_usdc — user wants to swap ETH for USDC via Uniswap (use this for "swap", "trade", "convert to USDC").
3) clarify — not enough information (missing amount or recipient for a transfer). Include a short "message" question.
4) unsupported — anything else (NFTs, other tokens, bridges, etc.). Include "message" explaining briefly.

Also include "reasoning" (one short sentence) for transfer_eth and swap_eth_to_usdc.

Example output for transfer:
{"intent":"transfer_eth","recipient":"0x...","amount_eth":"0.001","reasoning":"..."}

Example for swap:
{"intent":"swap_eth_to_usdc","reasoning":"..."}

Example for clarify:
{"intent":"clarify","message":"What address should receive the ETH?"}`;

async function parseIntent(userText: string): Promise<ParsedIntent> {
  const client = new OpenAI({ apiKey: OPENAI_KEY });
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty OpenAI response");
  const data = JSON.parse(raw) as Record<string, unknown>;
  const intent = data.intent as string;

  if (intent === "transfer_eth") {
    const recipient = data.recipient as string;
    const amount_eth = String(data.amount_eth ?? "");
    if (!isAddress(recipient)) {
      return {
        intent: "clarify",
        message: `Invalid or missing recipient address. Got: ${recipient}`,
      };
    }
    try {
      parseEther(amount_eth);
    } catch {
      return {
        intent: "clarify",
        message: `Invalid amount. Use a decimal ETH amount (e.g. 0.0001). Got: ${amount_eth}`,
      };
    }
    return {
      intent: "transfer_eth",
      recipient: recipient as Address,
      amount_eth,
      reasoning: String(data.reasoning ?? ""),
    };
  }
  if (intent === "swap_eth_to_usdc") {
    return {
      intent: "swap_eth_to_usdc",
      reasoning: String(data.reasoning ?? ""),
    };
  }
  if (intent === "clarify") {
    return {
      intent: "clarify",
      message: String(data.message ?? "Could you provide more detail?"),
    };
  }
  return {
    intent: "unsupported",
    message: String(
      data.message ?? "This agent only supports ETH transfers and ETH→USDC swaps on Base Sepolia.",
    ),
  };
}

async function readUserLine(): Promise<string> {
  const argv = process.argv.slice(2).join(" ").trim();
  if (argv) return argv;

  return new Promise((resolve, reject) => {
    process.stdin.setEncoding("utf8");
    let buf = "";
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
    });
    process.stdin.on("end", () => {
      resolve(buf.trim());
    });
    process.stdin.on("error", reject);
  });
}

async function main() {
  console.log("══ OpenAI permission agent (Base Sepolia) ══\n");

  if (!OPENAI_KEY) {
    throw new Error("Set OPEN_AI_API_KEY or OPENAI_API_KEY");
  }
  if (!JAW_API_KEY) throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
  if (!SPENDER_PK) throw new Error("SPENDER_PRIVATE_KEY not set");
  if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

  const userText = await readUserLine();
  if (!userText) {
    console.log("Usage: pass a sentence as argv or pipe stdin.");
    process.exit(1);
  }

  console.log("You said:", userText, "\n");
  console.log("Parsing with OpenAI…");

  const parsed = await parseIntent(userText);
  console.log("Plan:", JSON.stringify(parsed, null, 2), "\n");

  if (parsed.intent === "clarify") {
    console.log(parsed.message);
    process.exit(0);
  }
  if (parsed.intent === "unsupported") {
    console.log(parsed.message);
    process.exit(0);
  }

  const resolved = await resolveAgent(API_BASE, PERMISSION_ID);
  printAgentContext(resolved);

  if (parsed.intent === "transfer_eth") {
    const amountWei = parseEther(parsed.amount_eth);
    const autonomous = withinDbNativeSpendHint(
      amountWei,
      resolved.nativeAllowanceWei,
    );
    if (!autonomous) {
      console.log(
        "\n⚠ Requested",
        parsed.amount_eth,
        "ETH exceeds DB-recorded native allowance → signature_request path.",
      );
    } else {
      console.log("\n✓ Within DB native spend hint → autonomous path.");
    }

    const description = `AI agent: send ${parsed.amount_eth} ETH → ${parsed.recipient.slice(0, 10)}… (${parsed.reasoning})`;

    await runEthTransfer({
      jawApiKey: JAW_API_KEY,
      spenderPk: SPENDER_PK,
      permissionId: PERMISSION_ID,
      apiBase: API_BASE,
      recipient: parsed.recipient,
      amountWei,
      description,
      useAutonomous: autonomous,
    });
    return;
  }

  // swap_eth_to_usdc — fixed size matches scripts/t.ts
  const swapWei = parseEther("0.0001");
  const autonomous = withinDbNativeSpendHint(
    swapWei,
    resolved.nativeAllowanceWei,
  );
  if (!autonomous) {
    console.log(
      "\n⚠ Swap uses 0.0001 ETH — over DB native allowance → signature_request path.",
    );
  } else {
    console.log("\n✓ Swap within DB native spend hint → autonomous path.");
  }

  await runSwapEthToUsdc({
    jawApiKey: JAW_API_KEY,
    spenderPk: SPENDER_PK,
    permissionId: PERMISSION_ID,
    apiBase: API_BASE,
    swapAmountWei: swapWei,
    useAutonomous: autonomous,
  });
}

main().catch((err) => {
  console.error("\n✗", err.message ?? err);
  process.exit(1);
});
