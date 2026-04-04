"use client";

import { useState, useCallback } from "react";
import { LedgerProvider, useLedger } from "@/lib/ledger";
import { DeviceConnect } from "./DeviceConnect";
import { DeviceInfo } from "./DeviceInfo";
import { AccountStatusCard } from "./AccountStatus";
import { DelegationFlow } from "./DelegationFlow";
import { SendTransaction } from "./SendTransaction";
import { GrantPermission } from "./GrantPermission";
import { AgentActivity } from "./AgentActivity";

type Tab = "wallet" | "agent";

function DashboardContent() {
  const { accountStatus } = useLedger();
  const [activeTab, setActiveTab] = useState<Tab>("wallet");

  return (
    <div className="flex flex-col gap-6">
      {/* Always visible */}
      <DeviceConnect />
      <DeviceInfo />
      <AccountStatusCard status={accountStatus} />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
        <button
          onClick={() => setActiveTab("wallet")}
          className={`flex-1 rounded-lg px-4 py-2 text-xs font-medium transition-all ${
            activeTab === "wallet"
              ? "bg-indigo-500/20 text-indigo-300"
              : "text-zinc-500 hover:text-zinc-400"
          }`}
        >
          Wallet
        </button>
        <button
          onClick={() => setActiveTab("agent")}
          className={`flex-1 rounded-lg px-4 py-2 text-xs font-medium transition-all ${
            activeTab === "agent"
              ? "bg-emerald-500/20 text-emerald-300"
              : "text-zinc-500 hover:text-zinc-400"
          }`}
        >
          Agent Monitor
        </button>
      </div>

      {/* Wallet tab */}
      {activeTab === "wallet" && (
        <div className="flex flex-col gap-6">
          <DelegationFlow />
          <SendTransaction />
          <GrantPermission onAgentRegistered={() => setActiveTab("agent")} />
        </div>
      )}

      {/* Agent Monitor tab */}
      {activeTab === "agent" && (
        <AgentActivity />
      )}
    </div>
  );
}

export function LedgerDashboard() {
  return (
    <LedgerProvider>
      <DashboardContent />
    </LedgerProvider>
  );
}
