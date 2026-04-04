import {
  type Address,
  type Hex,
  encodeFunctionData,
  serializeTransaction,
  hexToBytes,
} from "viem";
import { publicClient } from "../clients";
import { CHAIN_ID, JUSTAN_ACCOUNT_IMPL, PERMISSIONS_MANAGER } from "../config";
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
 * Check if the Permissions Manager is already an owner.
 */
export async function isPmOwner(address: Address): Promise<boolean> {
  try {
    return await publicClient.readContract({
      address,
      abi: justanAccountAbi,
      functionName: "isOwnerAddress",
      args: [PERMISSIONS_MANAGER],
    });
  } catch {
    return false;
  }
}

/**
 * Build an unsigned EIP-7702 (type 4) delegation transaction.
 * Sets the delegation AND adds the Permissions Manager as owner in one tx.
 *
 * calldata = addOwnerAddress(PERMISSIONS_MANAGER)
 * The self-call passes the onlyOwner check (msg.sender == address(this)).
 */
export async function buildDelegationTx(
  eoaAddress: Address,
  signedAuth: { chainId: number; address: Address; nonce: number; yParity: number; r: Hex; s: Hex },
) {
  const nonce = await publicClient.getTransactionCount({ address: eoaAddress });
  const feeData = await publicClient.estimateFeesPerGas();

  // Add Permissions Manager as owner via self-call
  const calldata = encodeFunctionData({
    abi: justanAccountAbi,
    functionName: "addOwnerAddress",
    args: [PERMISSIONS_MANAGER],
  });

  const tx = {
    type: "eip7702" as const,
    chainId: CHAIN_ID,
    nonce,
    to: eoaAddress,       // self-call: msg.sender == address(this)
    value: 0n,
    data: calldata,       // addOwnerAddress(PM)
    maxFeePerGas: feeData.maxFeePerGas ?? 1_000_000_000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000n,
    gas: 200_000n,        // delegation + owner addition
    authorizationList: [signedAuth],
  };

  const serializedUnsigned = serializeTransaction(tx);
  const unsignedBytes = hexToBytes(serializedUnsigned);

  console.log("[delegation] Built type 4 tx:", {
    nonce, to: eoaAddress, fn: "addOwnerAddress(PM)", authNonce: signedAuth.nonce,
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

  return publicClient.request({
    method: "eth_sendRawTransaction",
    params: [signedTx],
  });
}

/**
 * Wait for tx confirmation and verify delegation + PM owner.
 */
export async function waitAndVerify(hash: Hex, eoaAddress: Address) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("[delegation] Tx status:", receipt.status, "block:", receipt.blockNumber);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await publicClient.getCode({ address: eoaAddress });
    const delegated = code?.startsWith("0xef0100") ?? false;
    console.log(`[delegation] getCode attempt ${attempt + 1}:`, code?.slice(0, 50) ?? "empty");

    if (delegated) {
      const pmIsOwner = await isPmOwner(eoaAddress).catch(() => false);
      console.log("[delegation] PM is owner:", pmIsOwner);
      return { delegated: true, pmIsOwner, receipt };
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.warn("[delegation] Code not detected after retries.");
  return { delegated: false, pmIsOwner: false, receipt };
}
