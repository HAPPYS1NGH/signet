"use client";

import { useState } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { useLedger } from "@/lib/ledger";
import {
  buildDelegationTx,
  broadcastDelegationTx,
  waitAndVerify,
} from "@/lib/account/delegation";
import { CHAIN_ID, ETH_PATH, JUSTAN_ACCOUNT_IMPL } from "@/lib/config";
import type { Address, Hex } from "viem";

type Step =
  | "idle"
  | "signing_auth"
  | "signing_tx"
  | "broadcasting"
  | "confirming"
  | "done"
  | "error";

export function DelegationFlow() {
  const { signer, eoaAddress, accountStatus, refreshAccountStatus } = useLedger();

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState<string | null>(null);

  if (!eoaAddress || !signer) return null;
  if (accountStatus === "ready" || accountStatus === "unknown" || accountStatus === "checking") {
    return null;
  }

  const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

  const handleSetup = async () => {
    try {
      setError(null);
      setTxHash(null);

      // Step 1: Sign EIP-7702 authorization
      setStep("signing_auth");
      setUserPrompt("Confirm the EIP-7702 delegation on your Ledger.");

      const { publicClient } = await import("@/lib/clients");
      const nonce = await publicClient.getTransactionCount({ address: eoaAddress });
      const authNonce = nonce + 1; // self-sponsored: sender nonce incremented before auth check

      console.log("[Setup] TX nonce:", nonce, "Auth nonce:", authNonce);

      const signedAuth = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signDelegationAuthorization(
            ETH_PATH, CHAIN_ID, JUSTAN_ACCOUNT_IMPL, authNonce,
          );
          observable.subscribe({
            next: (s) => {
              if (s.status === DeviceActionStatus.Completed) resolve(s.output as { r: string; s: string; v: number });
              else if (s.status === DeviceActionStatus.Error) reject(s.error);
            },
            error: reject,
          });
        },
      );

      setUserPrompt(null);

      const formattedAuth = {
        chainId: CHAIN_ID,
        address: JUSTAN_ACCOUNT_IMPL as Address,
        nonce: authNonce,
        yParity: signedAuth.v % 2,
        r: `0x${strip0x(signedAuth.r)}` as Hex,
        s: `0x${strip0x(signedAuth.s)}` as Hex,
      };

      // Step 2: Sign the type 4 tx (delegation + addOwnerAddress(PM))
      setStep("signing_tx");
      setUserPrompt("Confirm the transaction on your Ledger. This sets delegation and adds the Permissions Manager as owner.");

      const { tx, unsignedBytes } = await buildDelegationTx(eoaAddress, formattedAuth);

      const txSig = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signTransaction(ETH_PATH, unsignedBytes);
          observable.subscribe({
            next: (s) => {
              if (s.status === DeviceActionStatus.Completed) resolve(s.output as { r: string; s: string; v: number });
              else if (s.status === DeviceActionStatus.Error) reject(s.error);
            },
            error: reject,
          });
        },
      );

      setUserPrompt(null);

      // Step 3: Broadcast
      setStep("broadcasting");
      const hash = await broadcastDelegationTx(tx, txSig);
      console.log("[Setup] Tx hash:", hash);
      setTxHash(hash);

      // Step 4: Wait & verify
      setStep("confirming");
      const result = await waitAndVerify(hash, eoaAddress);
      console.log("[Setup] Result:", result);

      setStep("done");
      await refreshAccountStatus();
    } catch (err) {
      console.error("Setup error:", err);
      setError(err instanceof Error ? err.message : "Setup failed");
      setStep("error");
      setUserPrompt(null);
    }
  };

  const stepLabels: Record<Step, string> = {
    idle: "",
    signing_auth: "Signing EIP-7702 authorization...",
    signing_tx: "Signing delegation + owner tx...",
    broadcasting: "Broadcasting...",
    confirming: "Confirming...",
    done: "Complete!",
    error: "Failed",
  };

  const isRunning = !["idle", "done", "error"].includes(step);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">Setup Smart Account</h2>

      <p className="mb-4 text-sm text-zinc-400">
        One transaction: EIP-7702 delegation + adds Permissions Manager as owner. Requires ETH for gas.
      </p>

      <button
        onClick={handleSetup}
        disabled={isRunning}
        className={`rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
          isRunning
            ? "cursor-wait bg-white/5 text-zinc-500"
            : "bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
        }`}
      >
        {isRunning ? stepLabels[step] : "Begin Setup"}
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

      {txHash && (
        <div className="mt-4 rounded-lg bg-white/5 px-4 py-3">
          <p className="text-xs text-zinc-500">Transaction</p>
          <a
            href={`https://sepolia.basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all font-mono text-xs text-indigo-400 hover:text-indigo-300"
          >
            {txHash}
          </a>
        </div>
      )}

      {step === "done" && (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm text-emerald-400">Smart account ready! Delegation + Permissions Manager owner set.</p>
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
