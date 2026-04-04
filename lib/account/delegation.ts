import {
  type Address,
  type Hex,
  serializeTransaction,
  hexToBytes,
} from "viem";
import { publicClient } from "../clients";
import { CHAIN_ID, JUSTAN_ACCOUNT_IMPL } from "../config";
import { justanAccountAbi } from "../abi/justanAccount";

/**
 * Check if the EOA already has an EIP-7702 delegation active.
 */
export async function isDelegated(address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return code?.startsWith("0xef0100") ?? false;
}

/**
 * Check if the account is already initialized (ownerCount > 0).
 */
export async function isInitialized(address: Address): Promise<boolean> {
  try {
    const count = await publicClient.readContract({
      address,
      abi: justanAccountAbi,
      functionName: "ownerCount",
    });
    return count > 0n;
  } catch {
    return false;
  }
}

/**
 * Build an unsigned EIP-7702 (type 4) delegation-only transaction.
 * NO calldata — just sets the delegation code on the EOA.
 * Initialization happens separately via UserOp through the EntryPoint.
 */
export async function buildDelegationTx(
  eoaAddress: Address,
  signedAuth: { chainId: number; address: Address; nonce: number; yParity: number; r: Hex; s: Hex },
) {
  const nonce = await publicClient.getTransactionCount({ address: eoaAddress });
  const feeData = await publicClient.estimateFeesPerGas();

  const tx = {
    type: "eip7702" as const,
    chainId: CHAIN_ID,
    nonce,
    to: eoaAddress,
    value: 0n,
    data: "0x" as Hex,            // no calldata — delegation only
    maxFeePerGas: feeData.maxFeePerGas ?? 1_000_000_000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000n,
    gas: 100_000n,
    authorizationList: [signedAuth],
  };

  const serializedUnsigned = serializeTransaction(tx);
  const unsignedBytes = hexToBytes(serializedUnsigned);

  console.log("[delegation] Built type 4 tx (delegation only):", {
    nonce,
    to: eoaAddress,
    authNonce: signedAuth.nonce,
  });

  return { tx, unsignedBytes };
}

/**
 * Assemble a signed delegation tx and broadcast it.
 */
export async function broadcastDelegationTx(
  tx: Parameters<typeof serializeTransaction>[0],
  signature: { r: string; s: string; v: number },
): Promise<Hex> {
  const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
  const yParity = signature.v >= 27 ? signature.v - 27 : signature.v;

  const signedTx = serializeTransaction(tx, {
    r: `0x${strip0x(signature.r)}` as Hex,
    s: `0x${strip0x(signature.s)}` as Hex,
    yParity,
  });

  console.log("[delegation] Broadcasting signed tx...");
  return publicClient.request({
    method: "eth_sendRawTransaction",
    params: [signedTx],
  });
}

/**
 * Wait for tx confirmation and verify delegation was set.
 * Retries getCode a few times to handle RPC propagation delay.
 */
export async function waitAndVerify(hash: Hex, eoaAddress: Address) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("[delegation] Tx status:", receipt.status, "block:", receipt.blockNumber);

  // Retry getCode — RPC nodes may need a moment to reflect the delegation
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await publicClient.getCode({ address: eoaAddress });
    const delegated = code?.startsWith("0xef0100") ?? false;
    console.log(`[delegation] getCode attempt ${attempt + 1}:`, code?.slice(0, 50) ?? "empty");

    if (delegated) {
      return { delegated: true, receipt };
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  // If still not set, warn but don't block — let the UserOp step surface the real error
  console.warn("[delegation] Code not detected after retries. Proceeding anyway.");
  return { delegated: false, receipt };
}
