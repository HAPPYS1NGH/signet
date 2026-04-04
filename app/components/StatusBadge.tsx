"use client";

import type { ConnectionStatus } from "@/lib/ledger";

const config: Record<ConnectionStatus, { label: string; color: string; pulse: boolean }> = {
  disconnected: { label: "Disconnected", color: "bg-zinc-500", pulse: false },
  discovering: { label: "Discovering...", color: "bg-amber-500", pulse: true },
  connecting: { label: "Connecting...", color: "bg-amber-500", pulse: true },
  connected: { label: "Connected", color: "bg-emerald-500", pulse: false },
  error: { label: "Error", color: "bg-red-500", pulse: false },
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  const { label, color, pulse } = config[status];

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      {label}
    </span>
  );
}
