"use client";

import { useState } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { useLedger } from "@/lib/ledger";
import {
  buildDelegationAndInitTx,
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
  if (accountStatus !== "not_delegated" && accountStatus !== "delegated_not_initialized") {
    return null;
  }

  const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

  const handleSetup = async () => {
    try {
      setError(null);
      setTxHash(null);

      // ========== STEP 1: Sign EIP-7702 authorization ==========
      setStep("signing_auth");
      setUserPrompt("Please confirm the EIP-7702 delegation on your Ledger device.");

      const { publicClient } = await import("@/lib/clients");
      const nonce = await publicClient.getTransactionCount({ address: eoaAddress });

      // EIP-7702 nonce: when sender == authority (self-sponsored), the sender's
      // nonce is incremented BEFORE the authorization list is processed.
      // So the auth nonce must be current nonce + 1.
      const authNonce = nonce + 1;
      console.log("[Setup] TX nonce:", nonce, "Auth nonce:", authNonce);

      const signedAuth = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signDelegationAuthorization(
            ETH_PATH,
            CHAIN_ID,
            JUSTAN_ACCOUNT_IMPL,
            authNonce,
          );
          observable.subscribe({
            next: (state) => {
              if (state.status === DeviceActionStatus.Completed) {
                console.log("[Setup] Auth signed:", state.output);
                resolve(state.output as { r: string; s: string; v: number });
              } else if (state.status === DeviceActionStatus.Error) {
                reject(state.error);
              }
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

      // ========== STEP 2: Build & sign the type 4 tx (delegate + initialize) ==========
      setStep("signing_tx");
      setUserPrompt(
        "Please confirm the transaction on your Ledger device. This sets the delegation and initializes your smart account.",
      );

      const { tx, unsignedBytes } = await buildDelegationAndInitTx(eoaAddress, formattedAuth);

      const txSig = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signTransaction(ETH_PATH, unsignedBytes);
          observable.subscribe({
            next: (state) => {
              if (state.status === DeviceActionStatus.Completed) {
                console.log("[Setup] Tx signed:", state.output);
                resolve(state.output as { r: string; s: string; v: number });
              } else if (state.status === DeviceActionStatus.Error) {
                reject(state.error);
              }
            },
            error: reject,
          });
        },
      );

      setUserPrompt(null);

      // ========== STEP 3: Broadcast ==========
      setStep("broadcasting");
      const hash = await broadcastDelegationTx(tx, txSig);
      console.log("[Setup] Tx hash:", hash);
      setTxHash(hash);

      // ========== STEP 4: Wait & verify ==========
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
    signing_tx: "Signing delegation + init transaction...",
    broadcasting: "Broadcasting transaction...",
    confirming: "Waiting for confirmation...",
    done: "Complete!",
    error: "Failed",
  };

  const isRunning = step !== "idle" && step !== "done" && step !== "error";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">
        {accountStatus === "not_delegated"
          ? "Setup: Delegate & Initialize"
          : "Setup: Initialize Account"}
      </h2>

      <p className="mb-4 text-sm text-zinc-400">
        {accountStatus === "not_delegated"
          ? "One transaction: sets EIP-7702 delegation and initializes with Ledger EOA + Permissions Manager as owners. Requires ETH for gas."
          : "Your account is delegated. This will initialize it with the two owners."}
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
          <p className="text-sm text-emerald-400">Smart account setup complete! Delegation active, owners initialized.</p>
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
