import type { Address, Hex } from "viem";
import type {
  DeviceSessionId,
  DeviceSessionState,
  DeviceManagementKit,
} from "@ledgerhq/device-management-kit";
import type { SignerEth } from "@ledgerhq/device-signer-kit-ethereum";

export type ConnectionStatus =
  | "disconnected"
  | "discovering"
  | "connecting"
  | "connected"
  | "error";

export type AccountStatus =
  | "unknown"
  | "checking"
  | "not_delegated"
  | "delegated_not_initialized"
  | "ready";

export interface LedgerContextValue {
  // --- Device ---
  dmk: DeviceManagementKit;
  connectionStatus: ConnectionStatus;
  sessionId: DeviceSessionId | null;
  deviceState: DeviceSessionState | null;
  signer: SignerEth | null;
  error: string | null;

  // --- Account ---
  eoaAddress: Address | null;
  accountStatus: AccountStatus;

  // --- Actions ---
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshAccountStatus: () => Promise<void>;
}
