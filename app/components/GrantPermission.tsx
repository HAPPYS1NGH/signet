"use client";

import { useState } from "react";
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { parseEther, type Address, type Hex } from "viem";
import { getUserOperationTypedData } from "viem/account-abstraction";
import { useLedger } from "@/lib/ledger";
import { ETH_PATH, CHAIN_ID, ENTRY_POINT_ADDRESS } from "@/lib/config";
import {
  buildUserOp,
  estimateGas,
  applyGasEstimate,
  toPackedUserOpForSigning,
  submitUserOp,
  waitForUserOpReceipt,
} from "@/lib/account/userOp";
import {
  buildPermission,
  buildApproveCall,
  extractPermissionId,
  storePermissionInRelay,
  type GrantPermissionParams,
  type SpendPeriod,
} from "@/lib/account/permissions";

type Step = "idle" | "building" | "estimating" | "signing" | "submitting" | "waiting" | "done" | "error";

const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ANY_TARGET = "0x3232323232323232323232323232323232323232";
const ANY_FN_SEL = "0x32323232";
const EMPTY_CALLDATA_FN_SEL = "0xe0e0e0e0";

const TARGET_PRESETS = [
  { label: "Custom", value: "" },
  { label: "Any Contract (Wildcard)", value: ANY_TARGET },
] as const;

const SELECTOR_PRESETS = [
  { label: "Custom", value: "" },
  { label: "Any Function (Wildcard)", value: ANY_FN_SEL },
  { label: "Empty Calldata", value: EMPTY_CALLDATA_FN_SEL },
] as const;

const TOKEN_PRESETS = [
  { label: "Native ETH", value: NATIVE_TOKEN },
  { label: "Custom Token", value: "" },
] as const;

interface GrantPermissionProps {
  onAgentRegistered?: (agentId: string) => void;
}

export function GrantPermission({ onAgentRegistered }: GrantPermissionProps = {}) {
  const { signer, eoaAddress, accountStatus } = useLedger();

  // Form state
  const [spender, setSpender] = useState("");
  const [expiryHours, setExpiryHours] = useState("24");
  const [callTargetPreset, setCallTargetPreset] = useState("");
  const [callTargetCustom, setCallTargetCustom] = useState("");
  const [callSelectorPreset, setCallSelectorPreset] = useState("");
  const [callSelectorCustom, setCallSelectorCustom] = useState("");
  const [spendTokenPreset, setSpendTokenPreset] = useState(NATIVE_TOKEN);
  const [spendTokenCustom, setSpendTokenCustom] = useState("");
  const [spendAllowance, setSpendAllowance] = useState("0.01");
  const [spendPeriod, setSpendPeriod] = useState<SpendPeriod>("day");

  // Flow state
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [permissionId, setPermissionId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  if (!eoaAddress || !signer || accountStatus !== "ready") return null;

  const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

  const handleGrant = async () => {
    try {
      setError(null);
      setTxHash(null);
      setAgentId(null);

      console.log("[GrantPermission] Starting grant flow...");
      console.log("[GrantPermission] Account:", eoaAddress);
      console.log("[GrantPermission] Spender:", spender);

      const callTarget = callTargetPreset || callTargetCustom;
      const callSelector = callSelectorPreset || callSelectorCustom;
      const spendToken = spendTokenPreset || spendTokenCustom;

      const params: GrantPermissionParams = {
        spender: spender as Address,
        expiry: Math.floor(Date.now() / 1000) + Number(expiryHours) * 3600,
        calls: callTarget
          ? [{ target: callTarget as Address, selector: (callSelector || "0x00000000") as Hex }]
          : [],
        spends: spendAllowance && Number(spendAllowance) > 0
          ? [{
              token: spendToken as Address,
              allowance: parseEther(spendAllowance),
              unit: spendPeriod,
            }]
          : [],
      };

      // Build permission struct
      console.log("[GrantPermission] Building permission struct...");
      const permission = buildPermission(eoaAddress, params);
      console.log("[GrantPermission] Permission:", JSON.stringify(permission, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
      const approveCall = buildApproveCall(permission);
      console.log("[GrantPermission] Approve calldata:", approveCall.data.slice(0, 20) + "...");

      // Build UserOp
      setStep("building");
      console.log("[GrantPermission] Building UserOp...");
      let userOp = await buildUserOp(eoaAddress, [approveCall]);

      console.log("[GrantPermission] UserOp built. Sender:", userOp.sender);

      // Estimate gas
      setStep("estimating");
      console.log("[GrantPermission] Estimating gas...");
      const gasEst = await estimateGas(userOp);
      userOp = applyGasEstimate(userOp, gasEst);

      console.log("[GrantPermission] Gas estimated:", JSON.stringify(gasEst, (_, v) => typeof v === "bigint" ? v.toString() : v));

      // Sign with Ledger
      setStep("signing");
      console.log("[GrantPermission] Requesting Ledger signature...");

      const typedData = getUserOperationTypedData({
        chainId: CHAIN_ID,
        entryPointAddress: ENTRY_POINT_ADDRESS,
        userOperation: {
          sender: userOp.sender,
          nonce: userOp.nonce,
          callData: userOp.callData,
          callGasLimit: userOp.callGasLimit,
          verificationGasLimit: userOp.verificationGasLimit,
          preVerificationGas: userOp.preVerificationGas,
          maxFeePerGas: userOp.maxFeePerGas,
          maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
          signature: userOp.signature,
          factory: userOp.factory ?? undefined,
          factoryData: userOp.factoryData ?? undefined,
          paymaster: userOp.paymaster ?? undefined,
          paymasterData: userOp.paymasterData ?? undefined,
          paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit ?? undefined,
          paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit ?? undefined,
        },
      });

      const sig = await new Promise<{ r: string; s: string; v: number }>(
        (resolve, reject) => {
          const { observable } = signer.signTypedData(
            ETH_PATH,
            typedData as unknown as Parameters<typeof signer.signTypedData>[1],
          );
          observable.subscribe({
            next: (state) => {
              if (state.status === DeviceActionStatus.Completed) resolve(state.output as { r: string; s: string; v: number });
              else if (state.status === DeviceActionStatus.Error) reject(state.error);
            },
            error: reject,
          });
        },
      );

      const vByte = sig.v >= 27 ? sig.v : sig.v + 27;
      userOp.signature = `0x${strip0x(sig.r)}${strip0x(sig.s)}${vByte.toString(16).padStart(2, "0")}` as Hex;

      console.log("[GrantPermission] Signed! Signature:", userOp.signature.slice(0, 20) + "...");

      // Submit
      setStep("submitting");
      console.log("[GrantPermission] Submitting UserOp...");
      const userOpHash = await submitUserOp(userOp);
      console.log("[GrantPermission] UserOp hash:", userOpHash);

      setStep("waiting");
      console.log("[GrantPermission] Waiting for receipt...");
      const receipt = await waitForUserOpReceipt(userOpHash);

      // Extract permissionId from PermissionApproved event
      const pid = extractPermissionId(receipt?.receipt?.logs ?? []);
      console.log("[GrantPermission] permissionId:", pid);
      setPermissionId(pid);
      setTxHash(receipt?.receipt?.transactionHash ?? userOpHash);

      // Store in JAW relay so wallet_getPermissions can find it
      if (pid) {
        console.log("[GrantPermission] Storing permission in relay...");
        await storePermissionInRelay(pid, permission).catch((err) =>
          console.warn("[GrantPermission] Relay store error:", err),
        );

        // Register agent in DB with full permission details
        console.log("[GrantPermission] Registering agent in DB...");
        try {
          const regRes = await fetch("/api/agents/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: eoaAddress,
              agentAddress: spender,
              permissionId: pid,
              delegationTxHash: receipt?.receipt?.transactionHash ?? null,
              permission: {
                account: eoaAddress,
                spender,
                start: Math.floor(Date.now() / 1000),
                end: params.expiry,
                salt: "0x0", // actual salt is on-chain, this is for reference
                calls: params.calls.map((c) => ({
                  target: c.target,
                  selector: c.selector,
                  checker: "0x0000000000000000000000000000000000000000",
                })),
                spends: params.spends.map((s) => ({
                  token: s.token,
                  allowance: s.allowance.toString(),
                  unit: s.unit,
                  multiplier: s.multiplier ?? 1,
                })),
              },
            }),
          });
          const regData = await regRes.json();
          if (regRes.ok) {
            console.log("[GrantPermission] Agent registered! agentId:", regData.agentId);
            setAgentId(regData.agentId);
            onAgentRegistered?.(regData.agentId);
          } else {
            console.warn("[GrantPermission] Agent registration failed:", regData.error);
          }
        } catch (regErr) {
          console.warn("[GrantPermission] Agent registration error:", regErr);
        }
      }

      console.log("[GrantPermission] Done!");
      setStep("done");
    } catch (err) {
      console.error("Grant permission error:", err);
      setError(err instanceof Error ? err.message : "Failed to grant permission");
      setStep("error");
    }
  };

  const isRunning = !["idle", "done", "error"].includes(step);

  const inputClass = "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-orange-500/30 focus:ring-1 focus:ring-orange-500/10";
  const selectClass = "w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-zinc-200 outline-none transition-colors focus:border-orange-500/30 cursor-pointer";
  const labelClass = "text-[11px] font-medium uppercase tracking-wider text-zinc-500";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6">
      <div className="flex flex-col gap-5">
        {/* Agent Address */}
        <label className="block">
          <span className={labelClass}>Agent wallet address</span>
          <p className="mb-1.5 text-[10px] text-zinc-600">The EOA that will execute transactions on your behalf</p>
          <input
            type="text"
            value={spender}
            onChange={(e) => setSpender(e.target.value)}
            placeholder="0x..."
            className={inputClass + " font-mono"}
          />
        </label>

        {/* Expiry */}
        <label className="block">
          <span className={labelClass}>Permission duration</span>
          <p className="mb-1.5 text-[10px] text-zinc-600">How long this permission remains valid (in hours)</p>
          <input
            type="number"
            value={expiryHours}
            onChange={(e) => setExpiryHours(e.target.value)}
            className={inputClass}
          />
        </label>

        {/* Call Restrictions */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
            <div>
              <p className="text-xs font-semibold text-zinc-300">Call Restrictions</p>
              <p className="text-[10px] text-zinc-600">Limit which contracts and functions the agent can call</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Target contract</span>
              <select
                value={callTargetPreset}
                onChange={(e) => {
                  setCallTargetPreset(e.target.value);
                  if (e.target.value) setCallTargetCustom("");
                }}
                className={selectClass}
              >
                {TARGET_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              {!callTargetPreset && (
                <input
                  type="text"
                  value={callTargetCustom}
                  onChange={(e) => setCallTargetCustom(e.target.value)}
                  placeholder="0x... contract address"
                  className={inputClass + " font-mono"}
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Function selector</span>
              <select
                value={callSelectorPreset}
                onChange={(e) => {
                  setCallSelectorPreset(e.target.value);
                  if (e.target.value) setCallSelectorCustom("");
                }}
                className={selectClass}
              >
                {SELECTOR_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              {!callSelectorPreset && (
                <input
                  type="text"
                  value={callSelectorCustom}
                  onChange={(e) => setCallSelectorCustom(e.target.value)}
                  placeholder="0xa9059cbb"
                  className={inputClass + " font-mono"}
                />
              )}
            </div>
          </div>
        </div>

        {/* Spend Limit */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <div>
              <p className="text-xs font-semibold text-zinc-300">Spend Limit</p>
              <p className="text-[10px] text-zinc-600">Cap how much value the agent can transfer per period</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Amount</span>
              <input
                type="text"
                value={spendAllowance}
                onChange={(e) => setSpendAllowance(e.target.value)}
                placeholder="0.01"
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Period</span>
              <select
                value={spendPeriod}
                onChange={(e) => setSpendPeriod(e.target.value as SpendPeriod)}
                className={selectClass}
              >
                <option value="minute">Per Minute</option>
                <option value="hour">Per Hour</option>
                <option value="day">Per Day</option>
                <option value="week">Per Week</option>
                <option value="month">Per Month</option>
                <option value="forever">One-time</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Token</span>
              <select
                value={spendTokenPreset}
                onChange={(e) => {
                  setSpendTokenPreset(e.target.value);
                  if (e.target.value) setSpendTokenCustom("");
                }}
                className={selectClass}
              >
                {TOKEN_PRESETS.map((p) => (
                  <option key={p.value || "custom"} value={p.value}>{p.label}</option>
                ))}
              </select>
              {!spendTokenPreset && (
                <input
                  type="text"
                  value={spendTokenCustom}
                  onChange={(e) => setSpendTokenCustom(e.target.value)}
                  placeholder="0x... ERC-20 address"
                  className={inputClass + " font-mono"}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleGrant}
        disabled={isRunning || !spender}
        className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all cursor-pointer ${
          isRunning
            ? "cursor-wait bg-white/[0.04] text-zinc-500"
            : !spender
              ? "cursor-not-allowed bg-white/[0.04] text-zinc-600"
              : "bg-gradient-to-r from-orange-500 to-amber-500 text-zinc-950 hover:shadow-[0_0_30px_rgba(249,115,22,0.15)] active:scale-[0.99]"
        }`}
      >
        {isRunning ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {step === "signing" ? "Confirm on your Ledger..." : step === "building" ? "Building transaction..." : step === "estimating" ? "Estimating gas..." : step === "submitting" ? "Submitting..." : "Waiting for confirmation..."}
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            Sign & Grant Permission
          </>
        )}
      </button>

      {step === "done" && (
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <p className="text-sm font-semibold text-emerald-400">Permission granted successfully</p>
          </div>
          {agentId && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Agent ID</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">Share this with your agent to start operating</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-black/30 px-3 py-2.5 font-mono text-xs text-amber-400 ring-1 ring-white/[0.06]">
                  {agentId}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(agentId)}
                  className="shrink-0 rounded-lg bg-white/[0.06] px-3 py-2.5 text-xs text-zinc-400 transition-colors hover:bg-white/[0.1] hover:text-zinc-300 cursor-pointer"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          {permissionId && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Permission ID</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">On-chain identifier for this permission scope</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-black/30 px-3 py-2.5 font-mono text-xs text-orange-400/90 ring-1 ring-white/[0.06]">
                  {permissionId}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(permissionId)}
                  className="shrink-0 rounded-lg bg-white/[0.06] px-3 py-2.5 text-xs text-zinc-400 transition-colors hover:bg-white/[0.1] hover:text-zinc-300 cursor-pointer"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          {txHash && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Transaction</p>
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center gap-1.5 break-all font-mono text-xs text-indigo-400 transition-colors hover:text-indigo-300"
              >
                {txHash}
                <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-400">
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
