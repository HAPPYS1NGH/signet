"use client";

import { useState } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { useLedger } from "@/lib/ledger";
import {
  buildDelegationTx,
  broadcastDelegationTx,
  waitAndVerify,
} from "@/lib/account/delegation";
import {
  encodeInitialize,
  buildUserOp,
  getUserOpHash,
  estimateGas,
  applyGasEstimate,
  submitUserOp,
  waitForUserOpReceipt,
} from "@/lib/account/userOp";
import { CHAIN_ID, ETH_PATH, JUSTAN_ACCOUNT_IMPL } from "@/lib/config";
import type { Address, Hex } from "viem";

type Step =
  | "idle"
  | "signing_auth"
  | "signing_delegation_tx"
  | "broadcasting_delegation"
  | "confirming_delegation"
  | "building_userop"
  | "estimating_gas"
  | "signing_userop"
  | "submitting_userop"
  | "waiting_userop"
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

      const needsDelegation = accountStatus === "not_delegated";

      // ==========================================
      // PHASE 1: Set delegation (type 4 tx, no calldata)
      // ==========================================
      if (needsDelegation) {
        setStep("signing_auth");
        setUserPrompt("Confirm the EIP-7702 delegation on your Ledger.");

        const { publicClient } = await import("@/lib/clients");
        const nonce = await publicClient.getTransactionCount({ address: eoaAddress });

        // Auth nonce = nonce + 1 (sender nonce incremented before auth check)
        const authNonce = nonce + 1;
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

        // Sign the type 4 tx
        setStep("signing_delegation_tx");
        setUserPrompt("Confirm the delegation transaction on your Ledger.");

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

        // Broadcast
        setStep("broadcasting_delegation");
        const hash = await broadcastDelegationTx(tx, txSig);
        console.log("[Setup] Delegation tx:", hash);
        setTxHash(hash);

        // Wait & verify
        setStep("confirming_delegation");
        await waitAndVerify(hash, eoaAddress);
        console.log("[Setup] Delegation confirmed and verified!");
      }

      // ==========================================
      // PHASE 2: Initialize via UserOp (through bundler/EntryPoint)
      // ==========================================
      setStep("building_userop");
      const initCall = encodeInitialize(eoaAddress);
      let userOp = await buildUserOp(eoaAddress, [initCall], false);

      // Estimate gas — delegation is on-chain now, so this should work
      setStep("estimating_gas");
      const gasEst = await estimateGas(userOp);
      userOp = applyGasEstimate(userOp, gasEst);

      // Sign the UserOp hash
      setStep("signing_userop");
      setUserPrompt("Confirm the initialization on your Ledger.");

      const opHash = getUserOpHash(userOp, CHAIN_ID);
      console.log("[Setup] UserOp hash:", opHash);

      // EIP-712 typed data matching JustanAccount's domain
      const typedData = {
        domain: {
          name: "JustanAccount",
          version: "1",
          chainId: CHAIN_ID,
          verifyingContract: eoaAddress,
        },
        types: {
          JustanAccountMessage: [{ name: "hash", type: "bytes32" }],
        },
        primaryType: "JustanAccountMessage",
        message: { hash: opHash },
      };

      const sig = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signTypedData(ETH_PATH, typedData);
          observable.subscribe({
            next: (s) => {
              if (s.status === DeviceActionStatus.Completed) resolve(s.output as { r: string; s: string; v: number });
              else if (s.status === DeviceActionStatus.Error) reject(s.error);
            },
            error: reject,
          });
        },
      );

      const vByte = sig.v >= 27 ? sig.v : sig.v + 27;
      userOp.signature = `0x${strip0x(sig.r)}${strip0x(sig.s)}${vByte.toString(16).padStart(2, "0")}` as Hex;

      setUserPrompt(null);

      // Submit
      setStep("submitting_userop");
      const userOpHash = await submitUserOp(userOp);
      console.log("[Setup] UserOp hash:", userOpHash);

      setStep("waiting_userop");
      await waitForUserOpReceipt(userOpHash);

      setTxHash(userOpHash);
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
    signing_delegation_tx: "Signing delegation transaction...",
    broadcasting_delegation: "Broadcasting delegation...",
    confirming_delegation: "Confirming delegation...",
    building_userop: "Building UserOp...",
    estimating_gas: "Estimating gas...",
    signing_userop: "Signing UserOp...",
    submitting_userop: "Submitting UserOp...",
    waiting_userop: "Waiting for confirmation...",
    done: "Complete!",
    error: "Failed",
  };

  const isRunning = !["idle", "done", "error"].includes(step);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">
        {accountStatus === "not_delegated"
          ? "Setup: Delegate & Initialize"
          : "Setup: Initialize Account"}
      </h2>

      <p className="mb-4 text-sm text-zinc-400">
        {accountStatus === "not_delegated"
          ? "Step 1: EIP-7702 delegation tx (requires ETH for gas). Step 2: Initialize owners via UserOp."
          : "Delegation active. Initialize the account with Ledger EOA + Permissions Manager as owners."}
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
          <p className="text-sm text-emerald-400">Smart account ready! Delegation active, owners initialized.</p>
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
