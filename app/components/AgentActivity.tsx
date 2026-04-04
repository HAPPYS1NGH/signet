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
    <div className="flex flex-col gap-4">
      {/* Agent Selector */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-100">Agent Monitor</h2>
          <button
            onClick={loadAgents}
            disabled={loadingAgents}
            className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
          >
            {loadingAgents ? "Loading..." : "↻ Refresh"}
          </button>
        </div>

        {/* DB Agents */}
        {agents.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-zinc-500 mb-2">Your registered agents:</p>
            <div className="flex flex-col gap-2">
              {agents.map((agent) => (
                <button
                  key={agent.agentId}
                  onClick={() => {
                    setSelectedAgentId(agent.agentId);
                    setUseManual(false);
                    setWatching(true);
                    setTransactions([]);
                  }}
                  className={`flex items-start justify-between rounded-xl border p-3 text-left transition-all ${
                    selectedAgentId === agent.agentId && !useManual
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          agent.status === "active" ? "bg-emerald-400" : "bg-zinc-600"
                        }`}
                      />
                      <code className="text-xs text-zinc-400 font-mono">
                        {agent.agentAddress.slice(0, 10)}...{agent.agentAddress.slice(-6)}
                      </code>
                      <span className="text-[10px] text-zinc-600">
                        {agent.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600 ml-3.5 font-mono truncate">
                      ID: {agent.agentId.slice(0, 18)}...
                    </p>
                    {agent.permission?.end > 0 && (
                      <p className="text-[10px] text-zinc-600 ml-3.5">
                        Expires: {new Date(agent.permission.end * 1000).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {selectedAgentId === agent.agentId && !useManual && (
                    <span className="text-[10px] text-emerald-400 shrink-0 ml-2">Selected</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {agents.length === 0 && !loadingAgents && (
          <p className="text-xs text-zinc-600 mb-4">
            No agents found. Grant a permission first to register an agent.
          </p>
        )}

        {/* Manual entry toggle */}
        <div>
          <button
            onClick={() => setUseManual(!useManual)}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {useManual ? "← Use account agents" : "Enter Agent ID manually →"}
          </button>

          {useManual && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={manualAgentId}
                onChange={(e) => setManualAgentId(e.target.value)}
                placeholder="Paste Agent ID (UUID)..."
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20 font-mono"
              />
              <button
                onClick={() => {
                  if (!manualAgentId) return;
                  setWatching(true);
                  setTransactions([]);
                  setError(null);
                }}
                disabled={!manualAgentId}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-medium transition-all ${
                  !manualAgentId
                    ? "cursor-not-allowed bg-white/5 text-zinc-600"
                    : "bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
                }`}
              >
                Watch
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Live Activity Feed */}
      {watching && activeAgentId && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-xs text-zinc-400">Live — polling every {POLL_INTERVAL / 1000}s</span>
            </div>
            <button
              onClick={() => { setWatching(false); setTransactions([]); }}
              className="text-xs text-zinc-500 hover:text-zinc-400"
            >
              Stop
            </button>
          </div>

          {/* Pending Signature Requests */}
          {pendingTxs.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                <p className="text-xs font-semibold text-amber-400">
                  Pending Approval ({pendingTxs.length})
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {pendingTxs.map((tx) => (
                  <div
                    key={tx.txId}
                    className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"
                  >
                    <p className="text-sm text-zinc-100 font-medium mb-1">{tx.description}</p>
                    <p className="text-[10px] text-zinc-600 mb-3 font-mono">{tx.txId}</p>

                    <div className="space-y-1 mb-4">
                      {tx.calls.map((call, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="text-zinc-500">→</span>
                          <code className="text-zinc-300">
                            {call.to.slice(0, 14)}...{call.to.slice(-6)}
                          </code>
                          {call.value !== "0" && (
                            <span className="text-amber-400 font-medium">
                              {formatEther(BigInt(call.value))} ETH
                            </span>
                          )}
                          {call.data && call.data !== "0x" && (
                            <span className="text-zinc-600">
                              data: {call.data.slice(0, 10)}...
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {signingTxId === tx.txId ? (
                      <div className="flex items-center gap-2 text-xs text-amber-400">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {signingStep}
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(tx)}
                          className="flex-1 rounded-lg bg-emerald-500/20 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-all"
                        >
                          ✓ Approve & Sign on Ledger
                        </button>
                        <button
                          onClick={() => handleReject(tx)}
                          className="rounded-lg bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-all"
                        >
                          ✗ Reject
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
              <p className="text-xs font-medium text-zinc-600 mb-2">History</p>
              <div className="flex flex-col gap-1">
                {historyTxs.slice(0, 20).map((tx) => (
                  <div
                    key={tx.txId}
                    className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300 truncate">{tx.description}</p>
                      <p className="text-[10px] text-zinc-600">
                        {new Date(tx.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        tx.status === "executed" || tx.status === "approved"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : tx.status === "rejected"
                            ? "bg-red-500/10 text-red-400"
                            : tx.status === "failed"
                              ? "bg-orange-500/10 text-orange-400"
                              : "bg-zinc-500/10 text-zinc-500"
                      }`}
                    >
                      {tx.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {transactions.length === 0 && (
            <div className="text-center py-6">
              <div className="text-2xl mb-2">👁</div>
              <p className="text-xs text-zinc-600">
                No activity yet. Waiting for agent requests...
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
