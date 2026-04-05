"use client";

import { useState, useEffect, useCallback } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { type Address, type Hex, formatEther } from "viem";
import { getUserOperationTypedData } from "viem/account-abstraction";
import { useLedger } from "@/lib/ledger";
import { ETH_PATH, CHAIN_ID, ENTRY_POINT_ADDRESS } from "@/lib/config";
import {
  buildUserOp,
  estimateGas,
  applyGasEstimate,
  toPackedUserOpForSigning,
  submitUserOp,
  waitForUserOpReceipt,
} from "@/lib/account/userOp";

interface AgentRecord {
  agentId: string;
  account: string;
  agentAddress: string;
  permissionId: string;
  delegationTxHash: string | null;
  status: "active" | "revoked";
  createdAt: string;
  permission: {
    end: number;
    spends: { token: string; allowance: string; unit: string }[];
    calls: { target: string; selector: string }[];
  };
}

interface TxRecord {
  txId: string;
  agentId: string;
  type: "autonomous" | "signature_request";
  status: "executed" | "pending" | "approved" | "rejected" | "failed";
  calls: { to: string; value: string; data?: string }[];
  description: string;
  userOpHash: string | null;
  txHash: string | null;
  createdAt: string;
}

const POLL_INTERVAL = 4000;

export function AgentActivity() {
  const { signer, eoaAddress, accountStatus } = useLedger();

  // Agent selection state
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [manualAgentId, setManualAgentId] = useState("");
  const [useManual, setUseManual] = useState(false);

  // Activity state
  const [watching, setWatching] = useState(false);
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [signingTxId, setSigningTxId] = useState<string | null>(null);
  const [signingStep, setSigningStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeAgentId = useManual ? manualAgentId : selectedAgentId;

  // Load agents from DB when account is ready
  const loadAgents = useCallback(async () => {
    if (!eoaAddress) return;
    setLoadingAgents(true);
    try {
      const res = await fetch(`/api/agents?account=${eoaAddress}`);
      if (!res.ok) return;
      const data = await res.json();
      const fetched: AgentRecord[] = data.agents ?? [];
      setAgents(fetched);
      // Auto-select the most recent active agent
      const active = fetched.find((a) => a.status === "active");
      if (active && !selectedAgentId) {
        setSelectedAgentId(active.agentId);
        setWatching(true);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingAgents(false);
    }
  }, [eoaAddress, selectedAgentId]);

  useEffect(() => {
    if (eoaAddress && accountStatus === "ready") {
      loadAgents();
    }
  }, [eoaAddress, accountStatus]);

  // Poll transactions
  const fetchTransactions = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const res = await fetch(`/api/agents/${activeAgentId}/tx`);
      if (!res.ok) return;
      const data = await res.json();
      setTransactions(data.transactions ?? []);
    } catch {
      // silently fail on poll
    }
  }, [activeAgentId]);

  useEffect(() => {
    if (!watching || !activeAgentId) return;
    fetchTransactions();
    const interval = setInterval(fetchTransactions, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [watching, fetchTransactions, activeAgentId]);

  if (!eoaAddress || !signer || accountStatus !== "ready") return null;

  const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

  const handleApprove = async (tx: TxRecord) => {
    try {
      setSigningTxId(tx.txId);
      setError(null);

      // Build calls exactly like SendTransaction — map DB call format to Call type
      const calls = tx.calls.map((c) => ({
        target: c.to as Address,
        value: BigInt(c.value),
        data: (c.data || "0x") as Hex,
      }));

      // 1. Build UserOp
      setSigningStep("Building UserOp...");
      let userOp = await buildUserOp(eoaAddress, calls);

      // 2. Estimate gas
      setSigningStep("Estimating gas...");
      const gasEst = await estimateGas(userOp);
      userOp = applyGasEstimate(userOp, gasEst);

      // 3. Sign — use viem's getUserOperationTypedData for correct EIP-712 hash
      //    (same approach as SendTransaction component)
      setSigningStep("Confirm on Ledger...");

      const packed = toPackedUserOpForSigning(userOp);
      const typedData = getUserOperationTypedData({
        chainId: CHAIN_ID,
        entryPointAddress: ENTRY_POINT_ADDRESS,
        userOperation: {
          sender: packed.sender,
          nonce: packed.nonce,
          callData: packed.callData,
          callGasLimit: userOp.callGasLimit,
          verificationGasLimit: userOp.verificationGasLimit,
          preVerificationGas: userOp.preVerificationGas,
          maxFeePerGas: userOp.maxFeePerGas,
          maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
          signature: userOp.signature,
          factory: userOp.factory ?? undefined,
          factoryData: userOp.factoryData ?? undefined,
          paymaster: userOp.paymaster ?? undefined,
          paymasterData: userOp.paymasterData ?? undefined,
          paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit ?? undefined,
          paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit ?? undefined,
        },
      });

      console.log("[Approve] Typed data domain:", typedData.domain);

      const sig = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signTypedData(
            ETH_PATH,
            typedData as unknown as Parameters<typeof signer.signTypedData>[1],
          );
          observable.subscribe({
            next: (state) => {
              if (state.status === DeviceActionStatus.Completed) resolve(state.output as { r: string; s: string; v: number });
              else if (state.status === DeviceActionStatus.Error) reject(state.error);
            },
            error: reject,
          });
        },
      );

      const vByte = sig.v >= 27 ? sig.v : sig.v + 27;
      userOp.signature = `0x${strip0x(sig.r)}${strip0x(sig.s)}${vByte.toString(16).padStart(2, "0")}` as Hex;

      // 4. Submit
      setSigningStep("Submitting...");
      const userOpHash = await submitUserOp(userOp);

      // 5. Wait for confirmation
      setSigningStep("Waiting for confirmation...");
      const receipt = await waitForUserOpReceipt(userOpHash);
      const txHash = receipt?.receipt?.transactionHash ?? userOpHash;

      // 6. Mark approved in DB
      await fetch(`/api/tx/${tx.txId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, signature: userOp.signature, txHash }),
      });

      await fetchTransactions();
      setSigningTxId(null);
      setSigningStep(null);
    } catch (err) {
      console.error("Approve error:", err);
      setError(err instanceof Error ? err.message : "Signing failed");
      setSigningTxId(null);
      setSigningStep(null);
    }
  };

  const handleReject = async (tx: TxRecord) => {
    try {
      await fetch(`/api/tx/${tx.txId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: false }),
      });
      await fetchTransactions();
    } catch (err) {
      console.error("Reject error:", err);
    }
  };

  const selectedAgent = agents.find((a) => a.agentId === selectedAgentId);
  const pendingTxs = transactions.filter((t) => t.status === "pending");
  const historyTxs = transactions.filter((t) => t.status !== "pending");

  return (
    <div className="flex flex-col gap-5">
      {/* Agent Selector */}
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
              <svg className="h-4 w-4 text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Delegated Agents</h2>
              <p className="text-[10px] text-zinc-600">Select an agent to monitor its on-chain activity</p>
            </div>
          </div>
          <button
            onClick={loadAgents}
            disabled={loadingAgents}
            className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-500 transition-all hover:bg-white/[0.08] hover:text-zinc-300 cursor-pointer"
          >
            <svg className={`h-3 w-3 ${loadingAgents ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            {loadingAgents ? "Syncing..." : "Refresh"}
          </button>
        </div>

        {/* DB Agents */}
        {agents.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-col gap-2">
              {agents.map((agent) => {
                const isSelected = selectedAgentId === agent.agentId && !useManual;
                const isActive = agent.status === "active";
                return (
                  <button
                    key={agent.agentId}
                    onClick={() => {
                      setSelectedAgentId(agent.agentId);
                      setUseManual(false);
                      setWatching(true);
                      setTransactions([]);
                    }}
                    className={`group relative flex items-start justify-between rounded-xl border p-4 text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-orange-500/30 bg-orange-500/[0.06] shadow-[0_0_24px_-6px_rgba(249,115,22,0.12)]"
                        : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <div className="relative">
                          <span
                            className={`block h-2 w-2 rounded-full ${
                              isActive ? "bg-emerald-400" : "bg-zinc-600"
                            }`}
                          />
                          {isActive && (
                            <span className="absolute inset-0 h-2 w-2 animate-ping rounded-full bg-emerald-400/40" />
                          )}
                        </div>
                        <code className="text-xs text-zinc-300 font-mono tracking-wide">
                          {agent.agentAddress.slice(0, 6)}...{agent.agentAddress.slice(-4)}
                        </code>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isActive
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-zinc-800 text-zinc-500"
                        }`}>
                          {isActive ? "Active" : "Revoked"}
                        </span>
                      </div>
                      <div className="ml-[18px] flex flex-col gap-0.5">
                        <p className="text-[10px] text-zinc-600 font-mono truncate">
                          {agent.agentId.slice(0, 24)}...
                        </p>
                        {agent.permission?.end > 0 && (
                          <p className="text-[10px] text-zinc-600">
                            Expires {new Date(agent.permission.end * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-[10px] font-semibold text-orange-400 shrink-0 ml-3">
                        <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                        </svg>
                        Monitoring
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {agents.length === 0 && !loadingAgents && (
          <div className="mb-4 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-5 text-center">
            <svg className="mx-auto mb-2 h-6 w-6 text-zinc-700" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
            <p className="text-xs text-zinc-500">
              No agents delegated yet. Grant a permission to get started.
            </p>
          </div>
        )}

        {/* Manual entry toggle */}
        <div className="border-t border-white/[0.06] pt-3">
          <button
            onClick={() => setUseManual(!useManual)}
            className="flex items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-zinc-400 cursor-pointer"
          >
            {useManual ? (
              <>
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
                Back to account agents
              </>
            ) : (
              <>
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                Enter Agent ID manually
              </>
            )}
          </button>

          {useManual && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={manualAgentId}
                onChange={(e) => setManualAgentId(e.target.value)}
                placeholder="Paste Agent ID (UUID)"
                className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-orange-500/30 font-mono"
              />
              <button
                onClick={() => {
                  if (!manualAgentId) return;
                  setWatching(true);
                  setTransactions([]);
                  setError(null);
                }}
                disabled={!manualAgentId}
                className={`shrink-0 rounded-xl px-5 py-2.5 text-xs font-medium transition-all cursor-pointer ${
                  !manualAgentId
                    ? "cursor-not-allowed bg-white/[0.04] text-zinc-600"
                    : "bg-orange-500/15 text-orange-400 hover:bg-orange-500/25"
                }`}
              >
                Monitor
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Live Activity Feed */}
      {watching && activeAgentId && (
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400/50" />
              </div>
              <div>
                <span className="text-xs font-medium text-zinc-300">Live Feed</span>
                <p className="text-[10px] text-zinc-600">Auto-refreshing every {POLL_INTERVAL / 1000}s</p>
              </div>
            </div>
            <button
              onClick={() => { setWatching(false); setTransactions([]); }}
              className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-500 transition-all hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
            >
              Stop
            </button>
          </div>

          {/* Pending Signature Requests */}
          {pendingTxs.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="relative">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 block" />
                  <span className="absolute inset-0 h-1.5 w-1.5 animate-ping rounded-full bg-amber-400/40" />
                </div>
                <p className="text-xs font-semibold text-amber-400">
                  Awaiting Your Approval ({pendingTxs.length})
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {pendingTxs.map((tx) => (
                  <div
                    key={tx.txId}
                    className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] p-4"
                  >
                    <p className="text-sm text-zinc-100 font-medium mb-1">{tx.description}</p>
                    <p className="text-[10px] text-zinc-600 mb-3 font-mono">{tx.txId}</p>

                    <div className="space-y-1.5 mb-4 rounded-lg bg-black/20 p-3">
                      {tx.calls.map((call, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <svg className="h-3 w-3 shrink-0 text-zinc-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </svg>
                          <code className="text-zinc-300">
                            {call.to.slice(0, 10)}...{call.to.slice(-4)}
                          </code>
                          {call.value !== "0" && (
                            <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-400 font-medium">
                              {formatEther(BigInt(call.value))} ETH
                            </span>
                          )}
                          {call.data && call.data !== "0x" && (
                            <span className="text-zinc-600 font-mono">
                              {call.data.slice(0, 10)}...
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {signingTxId === tx.txId ? (
                      <div className="flex items-center gap-2 rounded-lg bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-400">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {signingStep}
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(tx)}
                          className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/15 py-2.5 text-xs font-semibold text-emerald-300 transition-all hover:bg-emerald-500/25 cursor-pointer"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          Approve & Sign
                        </button>
                        <button
                          onClick={() => handleReject(tx)}
                          className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-4 py-2.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20 cursor-pointer"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          {historyTxs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-3 flex items-center gap-2">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                Transaction History
              </p>
              <div className="flex flex-col gap-1.5">
                {historyTxs.slice(0, 20).map((tx) => (
                  <div
                    key={tx.txId}
                    className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3.5 py-3 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300 truncate">{tx.description}</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {new Date(tx.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span
                      className={`ml-3 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                        tx.status === "executed" || tx.status === "approved"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : tx.status === "rejected"
                            ? "bg-red-500/10 text-red-400"
                            : tx.status === "failed"
                              ? "bg-orange-500/10 text-orange-400"
                              : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {tx.status === "executed" ? "Confirmed" : tx.status === "approved" ? "Signed" : tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {transactions.length === 0 && (
            <div className="flex flex-col items-center py-10">
              <div className="relative mb-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                  <svg className="h-6 w-6 text-zinc-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                  </svg>
                </div>
                <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/30" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400/60" />
                </span>
              </div>
              <p className="text-sm font-medium text-zinc-400">Listening for activity</p>
              <p className="mt-1 text-xs text-zinc-600">
                Transactions from your agent will appear here in real time
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-400">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
