"use client";

import { useState, useEffect, useCallback } from "react";
import { useLedger } from "@/lib/ledger";
import { DeviceInfo } from "./DeviceInfo";
import { SetupFlow } from "./SetupFlow";
import { SendTransaction } from "./SendTransaction";
import { GrantPermission } from "./GrantPermission";
import { AgentActivity } from "./AgentActivity";
import { CHAIN_ID } from "@/lib/config";

type View = "agents" | "grant";

interface AgentRecord {
  agentId: string;
  account: string;
  agentAddress: string;
  status: "active" | "revoked";
}

export function SignetDashboard() {
  const { eoaAddress, accountStatus, disconnect, connectionStatus } =
    useLedger();
  const [view, setView] = useState<View>("agents");
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [showDeviceInfo, setShowDeviceInfo] = useState(false);
  const [setupTxHash, setSetupTxHash] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (!eoaAddress) return;
    setLoadingAgents(true);
    try {
      const res = await fetch(`/api/agents?account=${eoaAddress}`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? []);
      }
    } catch {
      // fail silently
    } finally {
      setLoadingAgents(false);
    }
  }, [eoaAddress]);

  useEffect(() => {
    if (eoaAddress && accountStatus === "ready") {
      loadAgents();
    }
  }, [eoaAddress, accountStatus, loadAgents]);

  // Auto-show grant form if no agents
  useEffect(() => {
    if (!loadingAgents && agents.length === 0 && accountStatus === "ready") {
      setView("grant");
    }
  }, [loadingAgents, agents.length, accountStatus]);

  const needsSetup =
    accountStatus === "not_delegated" ||
    accountStatus === "delegated_not_initialized" ||
    accountStatus === "checking";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Top Bar ── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500">
              <span className="font-[var(--font-syne)] text-xs font-bold text-zinc-950">
                S
              </span>
            </div>
            <span className="font-[var(--font-syne)] text-sm font-bold">
              Signet
            </span>
          </div>

          <div className="flex items-center gap-3">
            {accountStatus === "ready" && (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1">
                <svg className="h-3 w-3 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Upgraded</span>
              </span>
            )}
            <div className="hidden items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${accountStatus === "ready" ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="max-w-[140px] truncate font-mono text-xs text-zinc-400">
                {eoaAddress}
              </span>
            </div>
            <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] text-zinc-600">
              Base Sepolia
            </span>
            <button
              onClick={disconnect}
              className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              Disconnect
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* ── Setup Flow ── */}
        {/* ── Setup Complete Screen ── */}
        {!needsSetup && setupTxHash && (
          <div className="flex flex-col items-center gap-8 py-10">
            {/* Upgraded badge */}
            <div className="relative">
              <div className="absolute -inset-3 rounded-full bg-emerald-500/10 blur-xl" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 ring-2 ring-emerald-500/25">
                <svg className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
            </div>

            {/* Badge pill */}
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-emerald-400">
              Upgraded
            </span>

            <div className="text-center">
              <h2 className="font-[var(--font-syne)] text-2xl font-bold text-zinc-100">
                Smart Account Active
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                EIP-7702 delegation and Permissions Manager are set up. Your EOA is now a smart account.
              </p>
            </div>

            {/* Tx hash card */}
            <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Transaction hash
              </p>
              <a
                href={`https://sepolia.basescan.org/tx/${setupTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 flex items-center gap-1.5 break-all font-[var(--font-geist-mono)] text-xs text-orange-400/80 transition-colors hover:text-orange-300"
              >
                {setupTxHash}
                <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            </div>

            <button
              onClick={() => setSetupTxHash(null)}
              className="rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition-all hover:shadow-[0_0_30px_rgba(249,115,22,0.2)] active:scale-[0.98]"
            >
              Continue to Dashboard
            </button>
          </div>
        )}

        {/* ── Setup Flow ── */}
        {needsSetup && (
          <div className="flex flex-col gap-6">
            <SetupFlow onComplete={(hash) => setSetupTxHash(hash)} />
            {accountStatus === "delegated_not_initialized" && (
              <SendTransaction />
            )}

            {/* Device info toggle */}
            <button
              onClick={() => setShowDeviceInfo(!showDeviceInfo)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              {showDeviceInfo ? "Hide device info" : "Show device info"}
            </button>
            {showDeviceInfo && <DeviceInfo />}
          </div>
        )}

        {/* ── Main Dashboard ── */}
        {accountStatus === "ready" && !setupTxHash && (
          <div className="flex flex-col gap-6">
            {/* Tab bar */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                <button
                  onClick={() => setView("agents")}
                  className={`rounded-lg px-5 py-2 text-xs font-medium transition-all ${
                    view === "agents"
                      ? "bg-white/[0.08] text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-400"
                  }`}
                >
                  Your Agents
                  {agents.length > 0 && (
                    <span className="ml-2 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] text-orange-400">
                      {agents.filter((a) => a.status === "active").length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setView("grant")}
                  className={`rounded-lg px-5 py-2 text-xs font-medium transition-all ${
                    view === "grant"
                      ? "bg-white/[0.08] text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-400"
                  }`}
                >
                  Grant Permission
                </button>
              </div>

              <button
                onClick={() => setShowDeviceInfo(!showDeviceInfo)}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {showDeviceInfo ? "Hide device" : "Device info"}
              </button>
            </div>

            {showDeviceInfo && <DeviceInfo />}

            {/* Agent Monitor view */}
            {view === "agents" && (
              <>
                {loadingAgents ? (
                  <div className="flex flex-col gap-3">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]"
                      />
                    ))}
                  </div>
                ) : agents.length === 0 ? (
                  /* Empty state */
                  <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10">
                      <svg
                        className="h-7 w-7 text-orange-400/60"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
                        />
                      </svg>
                    </div>
                    <h3 className="font-[var(--font-syne)] text-base font-bold">
                      No agents yet
                    </h3>
                    <p className="mt-2 text-sm text-zinc-500">
                      Grant a scoped permission to your first AI agent.
                      <br />
                      You define the rules — the blockchain enforces them.
                    </p>
                    <button
                      onClick={() => setView("grant")}
                      className="mt-6 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition-all hover:shadow-[0_0_30px_rgba(249,115,22,0.2)]"
                    >
                      Grant first permission
                    </button>
                  </div>
                ) : (
                  <AgentActivity />
                )}
              </>
            )}

            {/* Grant Permission view */}
            {view === "grant" && (
              <div className="flex flex-col gap-6">
                <div className="rounded-2xl border border-orange-500/10 bg-orange-500/[0.02] p-6">
                  <h2 className="font-[var(--font-syne)] text-base font-bold">
                    Grant agent permission
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Define what your agent can do. Every scope is enforced
                    on-chain — the agent can only operate within these bounds.
                  </p>
                </div>

                <GrantPermission
                  onAgentRegistered={() => {
                    loadAgents();
                    setView("agents");
                  }}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-white/[0.04] py-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-orange-500 to-amber-500">
              <span className="text-[8px] font-bold text-zinc-950">S</span>
            </div>
            <span className="text-[11px] text-zinc-700">Signet</span>
          </div>
          <p className="text-[11px] text-zinc-700">
            EIP-7702 &middot; Ledger &middot; Base Sepolia ({CHAIN_ID})
          </p>
        </div>
      </footer>
    </div>
  );
}
