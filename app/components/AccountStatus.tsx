"use client";

import type { AccountStatus as AccountStatusType } from "@/lib/ledger";

const statusConfig: Record<AccountStatusType, { label: string; description: string; color: string }> = {
  unknown: {
    label: "Unknown",
    description: "Connect your Ledger to check account status.",
    color: "text-zinc-500",
  },
  checking: {
    label: "Checking...",
    description: "Reading on-chain state.",
    color: "text-amber-400",
  },
  not_delegated: {
    label: "Not Delegated",
    description: "EIP-7702 delegation required. Sign an authorization to delegate your EOA to JustanAccount.",
    color: "text-amber-400",
  },
  delegated_not_initialized: {
    label: "Delegated — Not Initialized",
    description: "Delegation active. Send the first UserOp to initialize with owners.",
    color: "text-blue-400",
  },
  ready: {
    label: "Ready",
    description: "Smart account is active. You can send transactions.",
    color: "text-emerald-400",
  },
};

export function AccountStatusCard({ status }: { status: AccountStatusType }) {
  if (status === "unknown") return null;

  const { label, description, color } = statusConfig[status];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-zinc-100">Account Status</h2>
        <span className={`rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-xs font-medium ${color}`}>
          {label}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
    </div>
  );
}
