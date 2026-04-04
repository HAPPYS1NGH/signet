"use client";

import { useState, useCallback } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { useLedger } from "@/lib/ledger";
import {
  buildDelegationTx,
  broadcastDelegationTx,
  waitAndVerify,
} from "@/lib/account/delegation";
import { CHAIN_ID, ETH_PATH, JUSTAN_ACCOUNT_IMPL } from "@/lib/config";
import type { Address, Hex } from "viem";

type DelegationStep =
  | "idle"
  | "signing_auth"
  | "signing_tx"
  | "broadcasting"
  | "confirming"
  | "done"
  | "error";

/* ── Copy-to-clipboard button ── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={copy}
      className="group flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-400 transition-all hover:bg-white/[0.1] hover:text-zinc-200 active:scale-95"
      aria-label="Copy address"
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

/* ── Stepper dot + connector ── */
function StepIndicator({
  number,
  status,
  isLast,
}: {
  number: number;
  status: "done" | "active" | "upcoming";
  isLast: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
          status === "done"
            ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30"
            : status === "active"
              ? "bg-orange-500/20 text-orange-400 ring-2 ring-orange-500/40 shadow-[0_0_16px_rgba(249,115,22,0.15)]"
              : "bg-white/[0.04] text-zinc-600 ring-1 ring-white/[0.08]"
        }`}
      >
        {status === "done" ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          number
        )}
      </div>
      {!isLast && (
        <div
          className={`mt-1 h-8 w-px transition-colors duration-300 ${
            status === "done" ? "bg-emerald-500/30" : "bg-white/[0.06]"
          }`}
        />
      )}
    </div>
  );
}

export function SetupFlow({ onComplete }: { onComplete?: (txHash: string) => void }) {
  const { signer, eoaAddress, accountStatus, refreshAccountStatus } =
    useLedger();

  const [delegationStep, setDelegationStep] = useState<DelegationStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  if (!eoaAddress || !signer) return null;

  const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

  const checkBalance = async () => {
    setCheckingBalance(true);
    try {
      const { publicClient } = await import("@/lib/clients");
      const bal = await publicClient.getBalance({ address: eoaAddress });
      const ethValue = Number(bal) / 1e18;
      setBalance(ethValue.toFixed(6));
    } catch {
      setBalance("Error");
    } finally {
      setCheckingBalance(false);
    }
  };

  const handleSetup = async () => {
    try {
      setError(null);
      setTxHash(null);

      setDelegationStep("signing_auth");
      setUserPrompt("Confirm the EIP-7702 delegation on your Ledger.");

      const { publicClient } = await import("@/lib/clients");
      const nonce = await publicClient.getTransactionCount({
        address: eoaAddress,
      });
      const authNonce = nonce + 1;

      const signedAuth = await new Promise<{
        r: string;
        s: string;
        v: number;
      }>((resolve, reject) => {
        const { observable } = signer.signDelegationAuthorization(
          ETH_PATH,
          CHAIN_ID,
          JUSTAN_ACCOUNT_IMPL,
          authNonce
        );
        observable.subscribe({
          next: (s) => {
            if (s.status === DeviceActionStatus.Completed)
              resolve(s.output as { r: string; s: string; v: number });
            else if (s.status === DeviceActionStatus.Error) reject(s.error);
          },
          error: reject,
        });
      });

      setUserPrompt(null);

      const formattedAuth = {
        chainId: CHAIN_ID,
        address: JUSTAN_ACCOUNT_IMPL as Address,
        nonce: authNonce,
        yParity: signedAuth.v % 2,
        r: `0x${strip0x(signedAuth.r)}` as Hex,
        s: `0x${strip0x(signedAuth.s)}` as Hex,
      };

      setDelegationStep("signing_tx");
      setUserPrompt(
        "Confirm the transaction on your Ledger. This sets delegation and adds the Permissions Manager as owner."
      );

      const { tx, unsignedBytes } = await buildDelegationTx(
        eoaAddress,
        formattedAuth
      );

      const txSig = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signTransaction(
            ETH_PATH,
            unsignedBytes
          );
          observable.subscribe({
            next: (s) => {
              if (s.status === DeviceActionStatus.Completed)
                resolve(s.output as { r: string; s: string; v: number });
              else if (s.status === DeviceActionStatus.Error) reject(s.error);
            },
            error: reject,
          });
        }
      );

      setUserPrompt(null);

      setDelegationStep("broadcasting");
      const hash = await broadcastDelegationTx(tx, txSig);
      setTxHash(hash);

      setDelegationStep("confirming");
      await waitAndVerify(hash, eoaAddress);

      setDelegationStep("done");
      await refreshAccountStatus();
      if (hash) onComplete?.(hash);
    } catch (err) {
      console.error("Setup error:", err);
      setError(err instanceof Error ? err.message : "Setup failed");
      setDelegationStep("error");
      setUserPrompt(null);
    }
  };

  const stepLabels: Record<DelegationStep, string> = {
    idle: "",
    signing_auth: "Signing authorization...",
    signing_tx: "Signing transaction...",
    broadcasting: "Broadcasting...",
    confirming: "Confirming on-chain...",
    done: "Complete!",
    error: "Failed",
  };

  const isDelegationRunning = !["idle", "done", "error"].includes(
    delegationStep
  );
  const hasFunds = balance !== null && balance !== "Error" && parseFloat(balance) > 0;

  /* Derive which setup step is active */
  const fundStatus: "done" | "active" | "upcoming" = hasFunds
    ? "done"
    : "active";
  const delegateStatus: "done" | "active" | "upcoming" =
    accountStatus === "ready" || delegationStep === "done"
      ? "done"
      : hasFunds
        ? "active"
        : "upcoming";
  const readyStatus: "done" | "active" | "upcoming" =
    accountStatus === "ready" ? "done" : "upcoming";

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl border border-orange-500/10 bg-gradient-to-br from-orange-500/[0.04] to-transparent p-6">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-orange-500/[0.03] blur-2xl" />
        <div className="relative">
          <h2 className="font-[var(--font-syne)] text-xl font-bold tracking-tight">
            Set up your account
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
            Your Ledger is connected. Fund your wallet with Base Sepolia ETH,
            then activate your smart account.
          </p>
        </div>
      </div>

      {/* ── Steps ── */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        {/* Step 1: Fund */}
        <div className="flex gap-4">
          <StepIndicator number={1} status={fundStatus} isLast={false} />
          <div className="flex-1 pb-6">
            <h3 className="text-sm font-semibold text-zinc-200">
              Fund your wallet
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Send Base Sepolia ETH to your address. You need a small amount for
              gas fees.
            </p>

            {/* Address card */}
            <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Your address
                  </p>
                  <p className="mt-1 break-all font-[var(--font-geist-mono)] text-[13px] leading-relaxed text-zinc-300 select-all">
                    {eoaAddress}
                  </p>
                </div>
                <CopyButton text={eoaAddress} />
              </div>

              {/* Balance check */}
              <div className="mt-3 flex items-center gap-3 border-t border-white/[0.06] pt-3">
                <button
                  onClick={checkBalance}
                  disabled={checkingBalance}
                  className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-400 transition-all hover:bg-white/[0.1] hover:text-zinc-200 active:scale-95 disabled:opacity-50"
                >
                  {checkingBalance ? (
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                      />
                    </svg>
                  )}
                  Check balance
                </button>

                {balance !== null && (
                  <span
                    className={`text-xs font-medium ${
                      hasFunds ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {balance === "Error"
                      ? "Failed to fetch"
                      : `${balance} ETH`}
                  </span>
                )}
              </div>
            </div>

            {/* Faucet hint */}
            <a
              href="https://www.alchemy.com/faucets/base-sepolia"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-zinc-600 transition-colors hover:text-orange-400"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
              Get free testnet ETH from a faucet
            </a>
          </div>
        </div>

        {/* Step 2: Delegate */}
        <div className="flex gap-4">
          <StepIndicator number={2} status={delegateStatus} isLast={false} />
          <div className="flex-1 pb-6">
            <h3 className="text-sm font-semibold text-zinc-200">
              Activate smart account
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              One transaction: EIP-7702 delegation + Permissions Manager setup.
            </p>

            {delegateStatus === "active" && (
              <div className="mt-3 flex flex-col gap-3">
                <button
                  onClick={handleSetup}
                  disabled={isDelegationRunning}
                  className={`w-fit rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
                    isDelegationRunning
                      ? "cursor-wait bg-white/[0.04] text-zinc-500"
                      : "bg-gradient-to-r from-orange-500 to-amber-500 text-zinc-950 shadow-[0_0_20px_rgba(249,115,22,0.15)] hover:shadow-[0_0_30px_rgba(249,115,22,0.25)] active:scale-[0.98]"
                  }`}
                >
                  {isDelegationRunning ? (
                    <span className="flex items-center gap-2">
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      {stepLabels[delegationStep]}
                    </span>
                  ) : (
                    "Begin Setup"
                  )}
                </button>

                {/* Ledger prompt */}
                {userPrompt && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] px-4 py-3">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/15">
                      <svg
                        className="h-3 w-3 text-amber-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                        />
                      </svg>
                    </div>
                    <p className="text-xs leading-relaxed text-amber-400/90">
                      {userPrompt}
                    </p>
                  </div>
                )}

                {/* Progress bar */}
                {isDelegationRunning && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500"
                      style={{
                        width:
                          delegationStep === "signing_auth"
                            ? "25%"
                            : delegationStep === "signing_tx"
                              ? "50%"
                              : delegationStep === "broadcasting"
                                ? "75%"
                                : delegationStep === "confirming"
                                  ? "90%"
                                  : "0%",
                      }}
                    />
                  </div>
                )}

                {/* Tx hash */}
                {txHash && (
                  <div className="rounded-lg bg-white/[0.03] px-4 py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                      Transaction
                    </p>
                    <a
                      href={`https://sepolia.basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block break-all font-[var(--font-geist-mono)] text-xs text-orange-400/80 transition-colors hover:text-orange-300"
                    >
                      {txHash}
                    </a>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-3 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-4 py-3">
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                      />
                    </svg>
                    <div>
                      <p className="text-xs font-medium text-red-400">
                        Setup failed
                      </p>
                      <p className="mt-0.5 text-xs text-red-400/70">{error}</p>
                      <button
                        onClick={handleSetup}
                        className="mt-2 text-xs font-medium text-red-400 underline underline-offset-2 transition-colors hover:text-red-300"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {delegateStatus === "upcoming" && (
              <p className="mt-2 text-[11px] text-zinc-600">
                Fund your wallet first to proceed.
              </p>
            )}
          </div>
        </div>

        {/* Step 3: Ready */}
        <div className="flex gap-4">
          <StepIndicator number={3} status={readyStatus} isLast />
          <div className="flex-1">
            <h3
              className={`text-sm font-semibold ${readyStatus === "done" ? "text-emerald-400" : "text-zinc-600"}`}
            >
              Ready to go
            </h3>
            <p className="mt-1 text-xs text-zinc-600">
              Smart account active. Start granting agent permissions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
