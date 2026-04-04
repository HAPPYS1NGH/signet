"use client";

import { useState } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { parseEther, type Address, type Hex } from "viem";
import { useLedger } from "@/lib/ledger";
import { ETH_PATH } from "@/lib/config";
import {
  buildUserOp,
  estimateGas,
  applyGasEstimate,
  getUserOpHash,
  submitUserOp,
  waitForUserOpReceipt,
  type Call,
} from "@/lib/account/userOp";

type Step = "idle" | "building" | "estimating" | "signing" | "submitting" | "waiting" | "done" | "error";

export function SendTransaction() {
  const { signer, eoaAddress, accountStatus } = useLedger();

  const [to, setTo] = useState("");
  const [value, setValue] = useState("0");
  const [data, setData] = useState("0x");

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState<string | null>(null);

  if (!eoaAddress || !signer || accountStatus !== "ready") return null;

  const handleSend = async () => {
    try {
      setError(null);
      setTxHash(null);

      const call: Call = {
        target: to as Address,
        value: parseEther(value),
        data: data as Hex,
      };

      // Build UserOp
      setStep("building");
      let userOp = await buildUserOp(eoaAddress, [call]);

      // Estimate gas
      setStep("estimating");
      const gasEst = await estimateGas(userOp);
      userOp = applyGasEstimate(userOp, gasEst);

      // Sign
      setStep("signing");
      setUserPrompt("Please confirm the message on your Ledger device.");

      const opHash = await getUserOpHash(userOp);
      const sig = await new Promise<{ r: string; s: string; v: number }>((resolve, reject) => {
        const { observable } = signer.signMessage(ETH_PATH, opHash);
        observable.subscribe({
          next: (state) => {
            if (state.status === DeviceActionStatus.Completed) {
              resolve(state.output as unknown as { r: string; s: string; v: number });
            } else if (state.status === DeviceActionStatus.Error) {
              reject(state.error);
            }
          },
          error: reject,
        });
      });

      const vHex = (sig.v & 1 ? "1c" : "1b");
      userOp.signature = `0x${sig.r}${sig.s}${vHex}` as Hex;
      setUserPrompt(null);

      // Submit
      setStep("submitting");
      const userOpHash = await submitUserOp(userOp);

      // Wait
      setStep("waiting");
      await waitForUserOpReceipt(userOpHash);
      setTxHash(userOpHash);
      setStep("done");
    } catch (err) {
      console.error("Send error:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setStep("error");
      setUserPrompt(null);
    }
  };

  const isRunning = !["idle", "done", "error"].includes(step);

  const stepLabels: Record<Step, string> = {
    idle: "",
    building: "Building UserOp...",
    estimating: "Estimating gas...",
    signing: "Signing...",
    submitting: "Submitting...",
    waiting: "Waiting for confirmation...",
    done: "Sent!",
    error: "Failed",
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">Send Transaction</h2>

      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="text-xs text-zinc-500">To Address</span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x..."
            className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20"
          />
        </label>

        <label className="block">
          <span className="text-xs text-zinc-500">Value (ETH)</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.0"
            className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20"
          />
        </label>

        <label className="block">
          <span className="text-xs text-zinc-500">Call Data (hex)</span>
          <input
            type="text"
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder="0x"
            className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20"
          />
        </label>
      </div>

      <button
        onClick={handleSend}
        disabled={isRunning || !to}
        className={`mt-4 rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
          isRunning
            ? "cursor-wait bg-white/5 text-zinc-500"
            : !to
              ? "cursor-not-allowed bg-white/5 text-zinc-600"
              : "bg-white/10 text-zinc-100 hover:bg-white/20"
        }`}
      >
        {isRunning ? stepLabels[step] : "Send UserOp"}
      </button>

      {isRunning && (
        <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {stepLabels[step]}
        </div>
      )}

      {userPrompt && (
        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
          {userPrompt}
        </div>
      )}

      {txHash && step === "done" && (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm text-emerald-400">Transaction submitted!</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-400">{txHash}</p>
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
