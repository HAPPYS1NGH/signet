# OpenAI Agent REPL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `scripts/openaiAgent.ts` into a persistent REPL — no args = interactive loop, args still work as single-shot.

**Architecture:** Wrap the existing `main()` logic in a `readline` loop. The `parseIntent` + execution path is untouched. Single file change only.

**Tech Stack:** Node.js `readline` (built-in), existing `openai`, `viem`, `@jaw.id/core`, `tsx`

---

### Task 1: Add REPL loop to `scripts/openaiAgent.ts`

**Files:**
- Modify: `scripts/openaiAgent.ts`

The current `main()` reads one line (from argv or stdin) then exits. We replace it with:
- If argv args are present → run once and exit (existing behaviour preserved)
- If no args → open a `readline` interface and loop until the user types `exit` or `quit`

- [ ] **Step 1: Open `scripts/openaiAgent.ts` and locate `readUserLine` and `main`**

Read the file so you have the full current source in context before editing.

- [ ] **Step 2: Replace `readUserLine` with a single-shot helper and add `runRepl`**

Replace the entire file content with the following. The key changes are:
1. `readArgv()` — returns argv string or `null` (no stdin read)
2. `runOnce(userText)` — the single command execution extracted from old `main()`
3. `runRepl()` — readline loop
4. `main()` — dispatches to `runOnce` or `runRepl`

```typescript
/**
 * Natural-language agent: OpenAI parses intent, then either executes with
 * permission (autonomous) or posts a signature_request when over the DB
 * spend hint — same flows as executeWithPermission.ts / exceedLimitRequest.ts.
 *
 * Single-shot usage:
 *   npx tsx scripts/openaiAgent.ts "Send 0.0001 ETH to 0x..."
 *
 * REPL usage (no args):
 *   npx tsx scripts/openaiAgent.ts
 *
 * Env:
 *   OPEN_AI_API_KEY or OPENAI_API_KEY
 *   SPENDER_PRIVATE_KEY, PERMISSION_ID, NEXT_PUBLIC_JAW_API_KEY
 *   API_BASE (optional, default http://localhost:3000)
 */

import OpenAI from "openai";
import * as readline from "readline";
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
      data.message ??
        "This agent only supports ETH transfers and ETH→USDC swaps on Base Sepolia.",
    ),
  };
}

/** Execute one parsed user command. Returns false if the agent should stop. */
async function runOnce(userText: string): Promise<void> {
  console.log("\nYou said:", userText);
  console.log("Parsing with OpenAI…");

  const parsed = await parseIntent(userText);
  console.log("Plan:", JSON.stringify(parsed, null, 2), "\n");

  if (parsed.intent === "clarify") {
    console.log("clarify:", parsed.message);
    return;
  }
  if (parsed.intent === "unsupported") {
    console.log("unsupported:", parsed.message);
    return;
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

  // swap_eth_to_usdc — fixed size
  const swapWei = parseEther("0.0001");
  const autonomous = withinDbNativeSpendHint(swapWei, resolved.nativeAllowanceWei);
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

async function runRepl(): Promise<void> {
  console.log("══ Signet AI Agent REPL (Base Sepolia) ══");
  console.log("Commands: plain English — e.g. 'send 0.001 ETH to 0x...'");
  console.log("          'swap eth to usdc'");
  console.log("Type 'exit' or 'quit' to stop.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "exit" || input === "quit") {
      console.log("Goodbye.");
      rl.close();
      break;
    }

    try {
      await runOnce(input);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("\n✗", msg);
    }

    console.log();
    rl.prompt();
  }
}

async function main() {
  if (!OPENAI_KEY) throw new Error("Set OPEN_AI_API_KEY or OPENAI_API_KEY");
  if (!JAW_API_KEY) throw new Error("NEXT_PUBLIC_JAW_API_KEY not set");
  if (!SPENDER_PK) throw new Error("SPENDER_PRIVATE_KEY not set");
  if (!PERMISSION_ID) throw new Error("PERMISSION_ID not set");

  const argv = process.argv.slice(2).join(" ").trim();

  if (argv) {
    // Single-shot mode (original behaviour)
    console.log("══ OpenAI permission agent (Base Sepolia) ══\n");
    await runOnce(argv);
  } else {
    // REPL mode
    await runRepl();
  }
}

main().catch((err) => {
  console.error("\n✗", err.message ?? err);
  process.exit(1);
});
```

- [ ] **Step 3: Manually test single-shot mode still works**

```bash
cd /Users/happy/Documents/Development/Web3/Hackathon/Cannes/ledger-app
npx tsx scripts/openaiAgent.ts "send 0.0001 ETH to 0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e"
```

Expected: parses intent, prints plan JSON, executes (autonomous or escalation) then exits.

- [ ] **Step 4: Manually test REPL mode**

```bash
npx tsx scripts/openaiAgent.ts
```

Expected: prints REPL banner and `>` prompt. Type commands one by one:
- `send 0.0001 ETH to 0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e` → executes transfer
- `swap eth to usdc` → executes swap
- `send 5 ETH to 0x926a19D7429F9AD47b2cB2b0e5c46A9E69F05a3e` → exceeds limit, posts signature_request, waits for Ledger approval
- `exit` → prints "Goodbye." and exits cleanly

- [ ] **Step 5: Commit**

```bash
git add scripts/openaiAgent.ts docs/superpowers/plans/2026-04-05-openai-agent-repl.md
git commit -m "feat: convert openaiAgent to persistent REPL with single-shot fallback"
```
