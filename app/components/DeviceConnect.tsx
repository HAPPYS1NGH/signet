"use client";

import { useLedger } from "@/lib/ledger";
import { StatusBadge } from "./StatusBadge";

export function DeviceConnect() {
  const { connectionStatus, error, eoaAddress, connect, disconnect } = useLedger();

  const isLoading = connectionStatus === "discovering" || connectionStatus === "connecting";
  const isConnected = connectionStatus === "connected";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
            <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Ledger Device</h2>
            <StatusBadge status={connectionStatus} />
          </div>
        </div>

        <button
          onClick={isConnected ? disconnect : connect}
          disabled={isLoading}
          className={`rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
            isConnected
              ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : isLoading
                ? "cursor-wait bg-white/5 text-zinc-500"
                : "bg-white/10 text-zinc-100 hover:bg-white/20"
          }`}
        >
          {isLoading ? "Waiting..." : isConnected ? "Disconnect" : "Connect"}
        </button>
      </div>

      {/* EOA Address */}
      {eoaAddress && (
        <div className="mt-4 rounded-lg bg-white/5 px-4 py-3">
          <p className="text-xs text-zinc-500">EOA / Smart Account Address</p>
          <p className="mt-1 break-all font-mono text-sm text-emerald-400">{eoaAddress}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
