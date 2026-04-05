/**
 * Signet AI Agent — natural language blockchain execution on Base Sepolia.
 *
 * Single-shot:  npx tsx scripts/openaiAgent.ts "Send 0.0001 ETH to 0x..."
 * REPL (no args): npx tsx scripts/openaiAgent.ts
 *
 * Env: OPEN_AI_API_KEY, SPENDER_PRIVATE_KEY, PERMISSION_ID, NEXT_PUBLIC_JAW_API_KEY
 *      API_BASE (optional, default http://localhost:3000)
 */

import OpenAI from "openai";
import * as readline from "readline";
import { isAddress, parseEther, parseUnits, type Address, type Hex } from "viem";
import dotenv from "dotenv";

import {
  resolveAgent,
  withinDbNativeSpendHint,
  runEthTransfer,
  runSwapEthToUsdc,
  runUsdcTransfer,
  USDC_DECIMALS,
} from "./lib/permissionAgentRunner";

dotenv.config();

const OPENAI_KEY = process.env.OPEN_AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const JAW_API_KEY = process.env.NEXT_PUBLIC_JAW_API_KEY!;
const SPENDER_PK  = process.env.SPENDER_PRIVATE_KEY as Hex;
const PERMISSION_ID = process.env.PERMISSION_ID as Hex;
const API_BASE    = process.env.API_BASE ?? "http://localhost:3000";

type ParsedIntent =
  | { intent: "transfer_eth"; recipient: Address; amount_eth: string; reasoning: string }
  | { intent: "transfer_usdc"; recipient: Address; amount_usdc: string; reasoning: string }
  | { intent: "swap_eth_to_usdc"; reasoning: string }
  | { intent: "clarify"; message: string }
  | { intent: "unsupported"; message: string };

const SYSTEM = `You are a routing assistant for a blockchain agent on Base Sepolia (chain 84532).
The user speaks in plain language. You output ONLY valid JSON, no markdown.

Classify the request into one of:
1) transfer_eth — user wants to send native ETH to an address. Extract:
   - recipient: checksummed 0x address
   - amount_eth: decimal string e.g. "0.0001"
2) transfer_usdc — user wants to send USDC tokens to an address. Extract:
   - recipient: checksummed 0x address
   - amount_usdc: decimal string e.g. "10.5"
3) swap_eth_to_usdc — user wants to swap ETH for USDC via Uniswap.
4) clarify — not enough info (missing amount or recipient). Include a short "message" question.
5) unsupported — anything else. Include "message" explaining briefly.

Include "reasoning" (one short sentence) for transfer_eth, transfer_usdc, and swap_eth_to_usdc.

Examples:
{"intent":"transfer_eth","recipient":"0x...","amount_eth":"0.001","reasoning":"User wants to send ETH."}
{"intent":"transfer_usdc","recipient":"0x...","amount_usdc":"10.5","reasoning":"User wants to send USDC."}
{"intent":"swap_eth_to_usdc","reasoning":"User wants to convert ETH to USDC."}
{"intent":"clarify","message":"Which address should receive the funds?"}`;

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
  if (!raw) throw new Error("Empty response from OpenAI");
  const data = JSON.parse(raw) as Record<string, unknown>;
  const intent = data.intent as string;

  if (intent === "transfer_eth") {
    const recipient = data.recipient as string;
    const amount_eth = String(data.amount_eth ?? "");
    if (!isAddress(recipient)) {
      return { intent: "clarify", message: `I couldn't find a valid wallet address in your message. Could you share the full 0x address?` };
    }
    try { parseEther(amount_eth); } catch {
      return { intent: "clarify", message: `I couldn't parse the amount "${amount_eth}". Try something like "0.001 ETH".` };
    }
    return { intent: "transfer_eth", recipient: recipient as Address, amount_eth, reasoning: String(data.reasoning ?? "") };
  }
  if (intent === "transfer_usdc") {
    const recipient = data.recipient as string;
    const amount_usdc = String(data.amount_usdc ?? "");
    if (!isAddress(recipient)) {
      return { intent: "clarify", message: `I couldn't find a valid wallet address. Could you share the full 0x address?` };
    }
    try { parseUnits(amount_usdc, USDC_DECIMALS); } catch {
      return { intent: "clarify", message: `I couldn't parse the USDC amount "${amount_usdc}". Try something like "10" or "0.5".` };
    }
    return { intent: "transfer_usdc", recipient: recipient as Address, amount_usdc, reasoning: String(data.reasoning ?? "") };
  }
  if (intent === "swap_eth_to_usdc") {
    return { intent: "swap_eth_to_usdc", reasoning: String(data.reasoning ?? "") };
  }
  if (intent === "clarify") {
    return { intent: "clarify", message: String(data.message ?? "Could you give me a bit more detail?") };
  }
  return {
    intent: "unsupported",
    message: String(data.message ?? "I can only send ETH or swap ETH → USDC on Base Sepolia right now."),
  };
}

async function runOnce(userText: string): Promise<void> {
  process.stdout.write("  Thinking…");
  const parsed = await parseIntent(userText);
  process.stdout.write("\r  \r"); // clear "Thinking…"

  if (parsed.intent === "clarify") {
    console.log(`  ? ${parsed.message}`);
    return;
  }
  if (parsed.intent === "unsupported") {
    console.log(`  ✗ ${parsed.message}`);
    return;
  }

  if (parsed.intent === "transfer_eth") {
    console.log(`  → Send ${parsed.amount_eth} ETH to ${parsed.recipient}`);
  } else if (parsed.intent === "transfer_usdc") {
    console.log(`  → Send ${parsed.amount_usdc} USDC to ${parsed.recipient}`);
  } else {
    console.log(`  → Swap 0.0001 ETH to USDC`);
  }

  const resolved = await resolveAgent(API_BASE, PERMISSION_ID);

  if (parsed.intent === "transfer_usdc") {
    const amountUnits = parseUnits(parsed.amount_usdc, USDC_DECIMALS);
    const autonomous = resolved.usdcAllowanceUnits === null
      ? true
      : amountUnits <= resolved.usdcAllowanceUnits;

    if (autonomous) {
      console.log("  ✓ Within your spend limit — executing now…");
    } else {
      console.log("  ⚠ This exceeds your spend limit.");
      console.log("  Sending approval request to the Signet dashboard…");
      console.log(`  Open ${API_BASE} → Monitor tab → Approve & Sign on Ledger`);
    }

    await runUsdcTransfer({
      jawApiKey: JAW_API_KEY,
      spenderPk: SPENDER_PK,
      permissionId: PERMISSION_ID,
      apiBase: API_BASE,
      recipient: parsed.recipient,
      amountUnits,
      description: `AI agent: send ${parsed.amount_usdc} USDC → ${parsed.recipient.slice(0, 10)}… (${parsed.reasoning})`,
      useAutonomous: autonomous,
    });
    return;
  }

  if (parsed.intent === "transfer_eth") {
    const amountWei = parseEther(parsed.amount_eth);
    const autonomous = withinDbNativeSpendHint(amountWei, resolved.nativeAllowanceWei);

    if (autonomous) {
      console.log("  ✓ Within your spend limit — executing now…");
    } else {
      console.log("  ⚠ This exceeds your spend limit.");
      console.log("  Sending approval request to the Signet dashboard…");
      console.log(`  Open ${API_BASE} → Monitor tab → Approve & Sign on Ledger`);
    }

    await runEthTransfer({
      jawApiKey: JAW_API_KEY,
      spenderPk: SPENDER_PK,
      permissionId: PERMISSION_ID,
      apiBase: API_BASE,
      recipient: parsed.recipient,
      amountWei,
      description: `AI agent: send ${parsed.amount_eth} ETH → ${parsed.recipient.slice(0, 10)}… (${parsed.reasoning})`,
      useAutonomous: autonomous,
    });
    return;
  }

  // swap_eth_to_usdc
  const swapWei = parseEther("0.0001");
  const autonomous = withinDbNativeSpendHint(swapWei, resolved.nativeAllowanceWei);

  if (autonomous) {
    console.log("  ✓ Within your spend limit — executing swap now…");
  } else {
    console.log("  ⚠ This exceeds your spend limit.");
    console.log("  Sending approval request to the Signet dashboard…");
    console.log(`  Open ${API_BASE} → Monitor tab → Approve & Sign on Ledger`);
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

async function runRepl(): Promise<void> {
  console.log("┌─────────────────────────────────────────┐");
  console.log("│       Signet AI Agent  ·  Base Sepolia  │");
  console.log("└─────────────────────────────────────────┘");
  console.log("  Try: 'send 0.001 ETH to 0x...'");
  console.log("       'send 10 USDC to 0x...'");
  console.log("       'swap eth to usdc'");
  console.log("  Type 'exit' to quit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you > ",
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    if (input === "exit" || input === "quit") {
      console.log("  Goodbye.");
      rl.close();
      break;
    }

    try {
      await runOnce(input);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Error: ${msg}`);
    }

    console.log();
    rl.prompt();
  }
}

async function main() {
  if (!OPENAI_KEY)    throw new Error("OPEN_AI_API_KEY is not set");
  if (!JAW_API_KEY)   throw new Error("NEXT_PUBLIC_JAW_API_KEY is not set");
  if (!SPENDER_PK)    throw new Error("SPENDER_PRIVATE_KEY is not set");
  if (!PERMISSION_ID) throw new Error("PERMISSION_ID is not set");

  const argv = process.argv.slice(2).join(" ").trim();
  if (argv) {
    await runOnce(argv);
  } else {
    await runRepl();
  }
}

main().catch((err) => {
  console.error(`\n  ✗ ${err.message ?? err}`);
  process.exit(1);
});
