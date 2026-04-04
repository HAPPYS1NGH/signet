import {
  type Address,
  type Hex,
  encodeFunctionData,
  toHex,
  getAddress,
  keccak256,
  toEventSelector,
} from "viem";
import { permissionsManagerAbi } from "../abi/permissionsManager";
import { PERMISSIONS_MANAGER, CHAIN_ID } from "../config";

const JAW_PROXY_URL = "https://api.justaname.id/proxy/v1";
const JAW_API_KEY = process.env.NEXT_PUBLIC_JAW_API_KEY ?? "";

// --- Types ---

export type SpendPeriod = "minute" | "hour" | "day" | "week" | "month" | "year" | "forever";

export interface CallPermission {
  target: Address;
  selector: Hex;    // 4-byte function selector
  checker: Address; // validation contract (0x0 = none)
}

export interface SpendLimit {
  token: Address;
  allowance: bigint;
  unit: SpendPeriod;
  multiplier: number; // 1-65535
}

export interface Permission {
  account: Address;
  spender: Address;
  start: number;
  end: number;
  salt: bigint;
  calls: CallPermission[];
  spends: SpendLimit[];
}

export interface GrantPermissionParams {
  spender: Address;
  expiry: number;      // unix seconds
  calls: { target: Address; selector: Hex }[];
  spends: { token: Address; allowance: bigint; unit: SpendPeriod; multiplier?: number }[];
}

// --- Period Enum ---

function periodToEnum(period: SpendPeriod): number {
  const map: Record<SpendPeriod, number> = {
    minute: 0,
    hour: 1,
    day: 2,
    week: 3,
    month: 4,
    year: 4,    // year → month with multiplier * 12
    forever: 5,
  };
  return map[period];
}

// --- Build Permission ---

export function buildPermission(
  account: Address,
  params: GrantPermissionParams,
): Permission {
  const now = Math.floor(Date.now() / 1000);

  return {
    account: getAddress(account),
    spender: getAddress(params.spender),
    start: now,
    end: params.expiry,
    salt: BigInt(`0x${crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`),
    calls: params.calls.map((c) => ({
      target: getAddress(c.target),
      selector: c.selector,
      checker: "0x0000000000000000000000000000000000000000" as Address,
    })),
    spends: params.spends.map((s) => ({
      token: getAddress(s.token),
      allowance: s.allowance,
      unit: s.unit,
      multiplier: s.unit === "year" ? (s.multiplier ?? 1) * 12 : (s.multiplier ?? 1),
    })),
  };
}

// --- Encode for Contract ---

function permissionToContractArgs(p: Permission) {
  return {
    account: p.account,
    spender: p.spender,
    start: p.start,
    end: p.end,
    salt: p.salt,
    calls: p.calls.map((c) => ({
      target: c.target,
      selector: c.selector,
      checker: c.checker,
    })),
    spends: p.spends.map((s) => ({
      token: s.token,
      allowance: s.allowance,
      unit: periodToEnum(s.unit),
      multiplier: s.multiplier,
    })),
  };
}

/**
 * Encode PermissionsManager.approve(permission) calldata.
 */
export function encodeApprovePermission(permission: Permission): Hex {
  return encodeFunctionData({
    abi: permissionsManagerAbi,
    functionName: "approve",
    args: [permissionToContractArgs(permission)],
  });
}

/**
 * Encode PermissionsManager.revoke(permission) calldata.
 */
export function encodeRevokePermission(permission: Permission): Hex {
  return encodeFunctionData({
    abi: permissionsManagerAbi,
    functionName: "revoke",
    args: [permissionToContractArgs(permission)],
  });
}

/**
 * Build the call that the UserOp executes: execute(PM_ADDRESS, 0, approve(...))
 */
export function buildApproveCall(permission: Permission) {
  return {
    target: PERMISSIONS_MANAGER as Address,
    value: 0n,
    data: encodeApprovePermission(permission),
  };
}

/**
 * Build the call for revoking a permission.
 */
export function buildRevokeCall(permission: Permission) {
  return {
    target: PERMISSIONS_MANAGER as Address,
    value: 0n,
    data: encodeRevokePermission(permission),
  };
}

// PermissionApproved(bytes32 indexed permissionHash, (address,...) permission)
const PERMISSION_APPROVED_TOPIC = keccak256(
  new TextEncoder().encode(
    "PermissionApproved(bytes32,(address,address,uint48,uint48,uint256,(address,bytes4,address)[],(address,uint160,uint8,uint16)[]))"
  ) as unknown as Uint8Array
);

/**
 * Extract the permissionId (permissionHash) from UserOp receipt logs.
 * Looks for the PermissionApproved event emitted by the PermissionsManager.
 */
export function extractPermissionId(
  logs: Array<{ address: string; topics: string[]; data: string }>,
): Hex | null {
  for (const log of logs) {
    if (
      log.address.toLowerCase() === PERMISSIONS_MANAGER.toLowerCase() &&
      log.topics[0]?.toLowerCase() === PERMISSION_APPROVED_TOPIC.toLowerCase()
    ) {
      // topics[1] is the indexed permissionHash
      return log.topics[1] as Hex;
    }
  }
  return null;
}

/**
 * Store a granted permission in the JAW relay API.
 * This makes it visible via wallet_getPermissions.
 */
export async function storePermissionInRelay(
  permissionId: Hex,
  permission: Permission,
): Promise<void> {
  const body = {
    permissionId,
    account: permission.account,
    spender: permission.spender,
    start: permission.start,
    end: permission.end,
    salt: toHex(permission.salt),
    calls: permission.calls.map((c) => ({
      target: c.target,
      selector: c.selector,
      checker: c.checker,
    })),
    spends: permission.spends.map((s) => ({
      token: s.token,
      allowance: toHex(s.allowance),
      unit: s.unit,
      multiplier: s.multiplier,
    })),
    chainId: toHex(CHAIN_ID),
  };

  console.log("[permissions] Storing in relay:", JSON.stringify(body, null, 2));

  const res = await fetch(`${JAW_PROXY_URL}/permissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JAW_API_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("[permissions] Relay response:", res.status, text);

  if (!res.ok) {
    console.warn("[permissions] Relay store failed:", res.status, text);
  } else {
    console.log("[permissions] Stored in relay:", permissionId);
  }
}
