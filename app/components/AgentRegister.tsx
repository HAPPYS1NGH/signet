"use client";

import { useState } from "react";
import { useLedger } from "@/lib/ledger";

type Step = "idle" | "registering" | "done" | "error";

export function AgentRegister() {
  const { eoaAddress, accountStatus } = useLedger();

  const [agentAddress, setAgentAddress] = useState("");
  const [permissionId, setPermissionId] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  if (!eoaAddress || accountStatus !== "ready") return null;

  const handleRegister = async () => {
    try {
      setError(null);
      setStep("registering");

      const res = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: eoaAddress,
          agentAddress,
          permissionId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }

      const data = await res.json();
      setAgentId(data.agentId);
      setStep("done");
    } catch (err) {
      console.error("Agent registration error:", err);
      setError(err instanceof Error ? err.message : "Failed to register agent");
      setStep("error");
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">Register Agent</h2>

      {step !== "done" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-xs text-zinc-500">Agent Address (spender EOA)</span>
            <input
              type="text"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              placeholder="0x..."
              className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20"
            />
          </label>

          <label className="block">
            <span className="text-xs text-zinc-500">Permission ID (from grant step)</span>
            <input
              type="text"
              value={permissionId}
              onChange={(e) => setPermissionId(e.target.value)}
              placeholder="0x..."
              className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20"
            />
          </label>

          <button
            onClick={handleRegister}
            disabled={step === "registering" || !agentAddress || !permissionId}
            className={`mt-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
              step === "registering"
                ? "cursor-wait bg-white/5 text-zinc-500"
                : !agentAddress || !permissionId
                  ? "cursor-not-allowed bg-white/5 text-zinc-600"
                  : "bg-teal-500/20 text-teal-300 hover:bg-teal-500/30"
            }`}
          >
            {step === "registering" ? "Registering..." : "Register Agent"}
          </button>
        </div>
      )}

      {step === "done" && agentId && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm text-emerald-400">Agent registered!</p>
          <div className="mt-3">
            <p className="text-xs text-zinc-500">Agent ID (give this to your agent)</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white/5 px-3 py-2 font-mono text-xs text-amber-400">
                {agentId}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(agentId)}
                className="shrink-0 rounded-lg bg-white/5 px-3 py-2 text-xs text-zinc-400 hover:bg-white/10"
              >
                Copy
              </button>
            </div>
          </div>
          <button
            onClick={() => { setStep("idle"); setAgentId(null); }}
            className="mt-3 text-xs text-zinc-500 hover:text-zinc-400"
          >
            Register another
          </button>
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
