/**
 * Shared execution paths for permission-based agent scripts:
 * autonomous execution (within spend hint) vs signature_request escalation.
 */

import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import dotenv from "dotenv";

dotenv.config();

export const CHAIN_ID = 84532 as const;
export const NATIVE_TOKEN =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

const SWAP_ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
export const USDC_DECIMALS = 6;
const SWAP_FEE = 3000;

const erc20TransferAbi = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

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

export type JawAccount = Awaited<ReturnType<typeof Account.fromLocalAccount>>;

export interface ResolvedAgent {
  agentId: string;
  permissionEnd: number;
  spendLimitLabel: string;
  nativeAllowanceWei: bigint | null;
  usdcAllowanceUnits: bigint | null;
}

export interface CallPayload {
  to: Address;
  value: bigint;
  data: Hex;
}

/** Fetch agent + derive native ETH allowance from DB (best-effort; chain is authoritative). */
export async function resolveAgent(
  apiBase: string,
  permissionId: string,
): Promise<ResolvedAgent> {
  const res = await fetch(
    `${apiBase}/api/agents?permissionId=${permissionId}`,
  );
  if (res.status === 404) {
    throw new Error(
      `No agent found for permissionId ${permissionId}. Grant permission in the webapp first.`,
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to resolve agent: ${err.error ?? res.status}`);
  }
  const { agent } = await res.json();
  const spends = agent.permission?.spends ?? [];

  let nativeAllowanceWei: bigint | null = null;
  let usdcAllowanceUnits: bigint | null = null;

  for (const s of spends) {
    const t = (s.token as string).toLowerCase();
    if (
      t === NATIVE_TOKEN.toLowerCase() ||
      t === "0x0000000000000000000000000000000000000000"
    ) {
      try { nativeAllowanceWei = BigInt(s.allowance); } catch { /* ignore */ }
    } else if (t === USDC.toLowerCase()) {
      try { usdcAllowanceUnits = BigInt(s.allowance); } catch { /* ignore */ }
    }
  }

  const firstSpend = spends[0];
  const spendLimitLabel =
    firstSpend && firstSpend.allowance && firstSpend.allowance !== "0"
      ? `${formatEther(BigInt(firstSpend.allowance))} ETH / ${firstSpend.unit ?? "period"}`
      : "no spend limit recorded";

  return {
    agentId: agent.agentId as string,
    permissionEnd: agent.permission?.end ?? 0,
    spendLimitLabel,
    nativeAllowanceWei,
    usdcAllowanceUnits,
  };
}

/** If we know native allowance from DB, requested value must be <= allowance for autonomous path. */
export function withinDbNativeSpendHint(
  requestedWei: bigint,
  nativeAllowanceWei: bigint | null,
): boolean {
  if (nativeAllowanceWei === null) return true;
  return requestedWei <= nativeAllowanceWei;
}

export async function createSpenderAccount(
  jawApiKey: string,
  spenderPk: Hex,
): Promise<{ local: ReturnType<typeof privateKeyToAccount>; account: JawAccount }> {
  const local = privateKeyToAccount(spenderPk);
  const account = await Account.fromLocalAccount(
    { chainId: CHAIN_ID, apiKey: jawApiKey },
    local,
  );
  return { local, account };
}

export async function waitForCalls(
  account: JawAccount,
  id: Hex,
  timeoutMs = 120_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("\nWaiting for confirmation");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    process.stdout.write(".");

    const status = await account.getCallStatus(id);
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

  throw new Error("Timed out waiting for UserOp confirmation");
}

export async function logAutonomousTx(params: {
  apiBase: string;
  agentId: string;
  calls: { to: string; value: string; data: string }[];
  description: string;
  userOpHash: string;
  txHash: string | null;
}) {
  const res = await fetch(`${params.apiBase}/api/agents/${params.agentId}/tx`, {
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

type TxStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

interface TxRecord {
  txId: string;
  status: TxStatus;
  signature: string | null;
  txHash: string | null;
}

export async function pollUntilExecuted(
  apiBase: string,
  txId: string,
  pollMs = 3_000,
  timeoutMs = 10 * 60_000,
): Promise<TxRecord> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("\n⏳ Waiting for owner approval on Ledger");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    process.stdout.write(".");

    let record: TxRecord;
    try {
      const res = await fetch(`${apiBase}/api/tx/${txId}`);
      if (!res.ok) continue;
      record = await res.json();
    } catch {
      continue;
    }

    if (record.status === "rejected") {
      process.stdout.write("\n");
      return record;
    }
    if (record.status === "approved" && record.txHash) {
      process.stdout.write("\n");
      return record;
    }
    if (record.status === "approved") {
      process.stdout.write("🔄");
    }
  }

  throw new Error(
    `Timed out after ${timeoutMs / 1000}s. Check the webapp Agent Monitor tab.`,
  );
}

export async function postSignatureRequest(params: {
  apiBase: string;
  agentId: string;
  calls: { to: string; value: string; data: string }[];
  description: string;
}) {
  const postRes = await fetch(
    `${params.apiBase}/api/agents/${params.agentId}/tx`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "signature_request",
        calls: params.calls,
        description: params.description,
      }),
    },
  );
  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({ error: postRes.statusText }));
    throw new Error(`Failed to post signature request: ${err.error ?? postRes.status}`);
  }
  return postRes.json() as Promise<{ txId: string; status: string }>;
}

function buildSwapCalls(smartAccount: Address, swapAmountWei: bigint): CallPayload[] {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const innerCalldata = encodeFunctionData({
    abi: exactInputSingleAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: USDC,
        fee: SWAP_FEE,
        recipient: smartAccount,
        amountIn: swapAmountWei,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const outerCalldata = encodeFunctionData({
    abi: multicallAbi,
    functionName: "multicall",
    args: [deadline, [innerCalldata]],
  });
  return [
    {
      to: SWAP_ROUTER,
      value: swapAmountWei,
      data: outerCalldata,
    },
  ];
}

export async function runEthTransfer(params: {
  jawApiKey: string;
  spenderPk: Hex;
  permissionId: Hex;
  apiBase: string;
  recipient: Address;
  amountWei: bigint;
  description: string;
  useAutonomous: boolean;
}) {
  const resolved = await resolveAgent(params.apiBase, params.permissionId);
  const { account } = await createSpenderAccount(
    params.jawApiKey,
    params.spenderPk,
  );

  const callsForApi = [
    {
      to: params.recipient,
      value: params.amountWei.toString(),
      data: "0x" as Hex,
    },
  ];

  if (params.useAutonomous) {
    console.log("\n🚀 Autonomous path (within spend limit)…");
    const result = await account.sendCalls(
      [{ to: params.recipient, value: params.amountWei }],
      { permissionId: params.permissionId },
    );
    const txHash = await waitForCalls(account, result.id as Hex);
    if (txHash) {
      console.log("  ✓ Tx hash:", txHash);
      console.log(`  Explorer: https://sepolia.basescan.org/tx/${txHash}`);
    }
    await logAutonomousTx({
      apiBase: params.apiBase,
      agentId: resolved.agentId,
      calls: callsForApi,
      description: params.description,
      userOpHash: result.id,
      txHash,
    });
    console.log("\n✨ Done (autonomous).");
    return;
  }

  console.log("\n📋 Escalation path: posting signature_request (over limit or forced)…");
  const { txId } = await postSignatureRequest({
    apiBase: params.apiBase,
    agentId: resolved.agentId,
    calls: callsForApi,
    description: params.description,
  });
  console.log("  txId:", txId);
  console.log(`  Open ${params.apiBase} → Agent Monitor → Approve & Sign on Ledger\n`);

  const final = await pollUntilExecuted(params.apiBase, txId);
  if (final.status === "rejected") {
    console.log("\n❌ Rejected by owner.");
    return;
  }
  if (final.status === "approved" && final.txHash) {
    console.log("\n✅ Executed on-chain:", final.txHash);
    console.log(`   https://sepolia.basescan.org/tx/${final.txHash}`);
  }
}

const DEFAULT_SWAP_WEI = parseEther("0.0001");

export async function runSwapEthToUsdc(params: {
  jawApiKey: string;
  spenderPk: Hex;
  permissionId: Hex;
  apiBase: string;
  swapAmountWei?: bigint;
  useAutonomous: boolean;
}) {
  const swapAmountWei = params.swapAmountWei ?? DEFAULT_SWAP_WEI;
  const resolved = await resolveAgent(params.apiBase, params.permissionId);
  const { account } = await createSpenderAccount(
    params.jawApiKey,
    params.spenderPk,
  );

  const payloads = buildSwapCalls(account.address as Address, swapAmountWei);
  const callsForApi = payloads.map((c) => ({
    to: c.to,
    value: c.value.toString(),
    data: c.data,
  }));

  const description = `Swap ${formatEther(swapAmountWei)} ETH → USDC (Uniswap router)`;

  if (params.useAutonomous) {
    console.log("\n🚀 Autonomous swap…");
    const result = await account.sendCalls(
      payloads.map((c) => ({ to: c.to, value: c.value, data: c.data })),
      { permissionId: params.permissionId },
    );
    const txHash = await waitForCalls(account, result.id as Hex);
    if (txHash) {
      console.log("  ✓ Tx hash:", txHash);
    }
    await logAutonomousTx({
      apiBase: params.apiBase,
      agentId: resolved.agentId,
      calls: callsForApi,
      description,
      userOpHash: result.id,
      txHash,
    });
    console.log("\n✨ Done (autonomous swap).");
    return;
  }

  console.log("\n📋 Escalation: signature_request for swap…");
  const { txId } = await postSignatureRequest({
    apiBase: params.apiBase,
    agentId: resolved.agentId,
    calls: callsForApi,
    description,
  });
  console.log("  txId:", txId);

  const final = await pollUntilExecuted(params.apiBase, txId);
  if (final.status === "approved" && final.txHash) {
    console.log("\n✅ Swap approved:", final.txHash);
  }
}

export async function runUsdcTransfer(params: {
  jawApiKey: string;
  spenderPk: Hex;
  permissionId: Hex;
  apiBase: string;
  recipient: Address;
  amountUnits: bigint;
  description: string;
  useAutonomous: boolean;
}) {
  const resolved = await resolveAgent(params.apiBase, params.permissionId);
  const { account } = await createSpenderAccount(params.jawApiKey, params.spenderPk);

  const data = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [params.recipient, params.amountUnits],
  });

  const callsForApi = [{ to: USDC, value: "0", data }];

  if (params.useAutonomous) {
    console.log("  Submitting transaction…");
    const result = await account.sendCalls(
      [{ to: USDC, value: 0n, data }],
      { permissionId: params.permissionId },
    );
    const txHash = await waitForCalls(account, result.id as Hex);
    if (txHash) {
      console.log(`  ✓ Done!  https://sepolia.basescan.org/tx/${txHash}`);
    }
    await logAutonomousTx({
      apiBase: params.apiBase,
      agentId: resolved.agentId,
      calls: callsForApi,
      description: params.description,
      userOpHash: result.id,
      txHash,
    });
    return;
  }

  const { txId } = await postSignatureRequest({
    apiBase: params.apiBase,
    agentId: resolved.agentId,
    calls: callsForApi,
    description: params.description,
  });
  console.log("  Approval request sent. txId:", txId);

  const final = await pollUntilExecuted(params.apiBase, txId);
  if (final.status === "rejected") {
    console.log("\n  ✗ Rejected by owner.");
    return;
  }
  if (final.status === "approved" && final.txHash) {
    console.log(`\n  ✓ Approved!  https://sepolia.basescan.org/tx/${final.txHash}`);
  }
}

export function printAgentContext(resolved: ResolvedAgent) {
  console.log("Agent ID      :", resolved.agentId);
  if (resolved.permissionEnd > 0) {
    console.log(
      "Permission exp:",
      new Date(resolved.permissionEnd * 1000).toLocaleString(),
    );
  }
  console.log("Spend limit    :", resolved.spendLimitLabel);
  if (resolved.nativeAllowanceWei !== null) {
    console.log(
      "Native allow. :",
      formatEther(resolved.nativeAllowanceWei),
      "ETH / period (first native row)",
    );
  }
}
