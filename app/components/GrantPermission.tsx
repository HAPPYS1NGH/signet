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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">Grant Permission</h2>

      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="text-xs text-zinc-500">Spender Address</span>
          <input
            type="text"
            value={spender}
            onChange={(e) => setSpender(e.target.value)}
            placeholder="0x... (who gets the permission)"
            className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-white/20"
          />
        </label>

        <label className="block">
          <span className="text-xs text-zinc-500">Expiry (hours from now)</span>
          <input
            type="number"
            value={expiryHours}
            onChange={(e) => setExpiryHours(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-white/20"
          />
        </label>

        <div className="border-t border-white/5 pt-3">
          <p className="mb-2 text-xs font-medium text-zinc-400">Call Permission (optional)</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <select
                value={callTargetPreset}
                onChange={(e) => {
                  setCallTargetPreset(e.target.value);
                  if (e.target.value) setCallTargetCustom("");
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 outline-none"
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
                  placeholder="0x... target contract"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <select
                value={callSelectorPreset}
                onChange={(e) => {
                  setCallSelectorPreset(e.target.value);
                  if (e.target.value) setCallSelectorCustom("");
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 outline-none"
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
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none"
                />
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 pt-3">
          <p className="mb-2 text-xs font-medium text-zinc-400">Spend Limit (optional)</p>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={spendAllowance}
              onChange={(e) => setSpendAllowance(e.target.value)}
              placeholder="Amount (ETH)"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none"
            />
            <select
              value={spendPeriod}
              onChange={(e) => setSpendPeriod(e.target.value as SpendPeriod)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 outline-none"
            >
              <option value="minute">Per Minute</option>
              <option value="hour">Per Hour</option>
              <option value="day">Per Day</option>
              <option value="week">Per Week</option>
              <option value="month">Per Month</option>
              <option value="forever">Forever</option>
            </select>
            <div className="flex flex-col gap-1">
              <select
                value={spendTokenPreset}
                onChange={(e) => {
                  setSpendTokenPreset(e.target.value);
                  if (e.target.value) setSpendTokenCustom("");
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 outline-none"
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
                  placeholder="0x... token address"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleGrant}
        disabled={isRunning || !spender}
        className={`mt-4 rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
          isRunning
            ? "cursor-wait bg-white/5 text-zinc-500"
            : !spender
              ? "cursor-not-allowed bg-white/5 text-zinc-600"
              : "bg-violet-500/20 text-violet-300 hover:bg-violet-500/30"
        }`}
      >
        {isRunning ? "Processing..." : "Grant Permission"}
      </button>

      {isRunning && (
        <div className="mt-4 flex items-center gap-2 text-sm text-amber-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {step === "signing" ? "Confirm on Ledger..." : `${step}...`}
        </div>
      )}

      {step === "done" && (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm text-emerald-400">Permission granted!</p>
          {agentId && (
            <div className="mt-2">
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
          )}
          {permissionId && (
            <div className="mt-2">
              <p className="text-xs text-zinc-500">Permission ID</p>
              <p className="mt-0.5 break-all font-mono text-xs text-violet-400">{permissionId}</p>
            </div>
          )}
          {txHash && (
            <div className="mt-2">
              <p className="text-xs text-zinc-500">Transaction</p>
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 block break-all font-mono text-xs text-indigo-400 hover:text-indigo-300"
              >
                {txHash}
              </a>
            </div>
          )}
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
