import { LedgerDashboard } from "../components/LedgerDashboard";
import { CHAIN_ID } from "@/lib/config";

export default function DevPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 font-sans">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20">
              <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
              </svg>
            </div>
            <h1 className="text-base font-semibold text-zinc-100">JustanAccount</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-400">
              EIP-7702
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-500">
              Base Sepolia ({CHAIN_ID})
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <LedgerDashboard />
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4 text-center text-xs text-zinc-600">
        Ledger + EIP-7702 Smart Account &middot; WebHID &middot; EntryPoint v0.8
      </footer>
    </div>
  );
}
