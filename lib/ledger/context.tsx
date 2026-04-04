"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { firstValueFrom, type Subscription } from "rxjs";
import {
  DeviceActionStatus,
  type DeviceSessionId,
  type DeviceSessionState,
} from "@ledgerhq/device-management-kit";
import { webHidIdentifier } from "@ledgerhq/device-transport-kit-web-hid";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import type { Address } from "viem";

import { dmk } from "./dmk";
import { ETH_PATH } from "../config";
import { isDelegated, isPmOwner } from "../account/delegation";
import type { ConnectionStatus, AccountStatus, LedgerContextValue } from "./types";

export const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  // --- Device state ---
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<DeviceSessionId | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Account state ---
  const [eoaAddress, setEoaAddress] = useState<Address | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("unknown");

  const stateSubRef = useRef<Subscription | null>(null);

  // Subscribe to device session state
  useEffect(() => {
    if (!sessionId) {
      setDeviceState(null);
      return;
    }
    const sub = dmk.getDeviceSessionState({ sessionId }).subscribe({
      next: (state) => setDeviceState(state),
      error: (err) => {
        console.error("Device session state error:", err);
      },
    });
    stateSubRef.current = sub;
    return () => sub.unsubscribe();
  }, [sessionId]);

  // Create signer when connected
  const signer = useMemo(() => {
    if (!sessionId) return null;
    return new SignerEthBuilder({ dmk, sessionId }).build();
  }, [sessionId]);

  // --- Check account status ---
  const refreshAccountStatus = useCallback(async () => {
    if (!eoaAddress) {
      setAccountStatus("unknown");
      return;
    }
    setAccountStatus("checking");
    try {
      const delegated = await isDelegated(eoaAddress);
      if (!delegated) {
        setAccountStatus("not_delegated");
        return;
      }
      const pmOwner = await isPmOwner(eoaAddress);
      setAccountStatus(pmOwner ? "ready" : "delegated_not_initialized");
    } catch (err) {
      console.error("Account status check error:", err);
      setAccountStatus("not_delegated");
    }
  }, [eoaAddress]);

  // Auto-check account status when address changes
  useEffect(() => {
    if (eoaAddress) refreshAccountStatus();
  }, [eoaAddress, refreshAccountStatus]);

  // --- Connect ---
  const connect = useCallback(async () => {
    try {
      setError(null);
      setConnectionStatus("discovering");

      const discoveredDevice = await firstValueFrom(
        dmk.startDiscovering({ transport: webHidIdentifier }),
      );

      setConnectionStatus("connecting");
      const newSessionId = await dmk.connect({ device: discoveredDevice });
      setSessionId(newSessionId);

      // Get ETH address from Ledger
      const tempSigner = new SignerEthBuilder({ dmk, sessionId: newSessionId }).build();
      const { observable } = tempSigner.getAddress(ETH_PATH, { checkOnDevice: false });

      const address = await new Promise<Address>((resolve, reject) => {
        observable.subscribe({
          next: (state) => {
            if (state.status === DeviceActionStatus.Completed) {
              resolve(state.output.address as Address);
            } else if (state.status === DeviceActionStatus.Error) {
              reject(state.error);
            }
          },
          error: reject,
        });
      });

      setEoaAddress(address);
      setConnectionStatus("connected");
    } catch (err) {
      console.error("Connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setConnectionStatus("error");
    }
  }, []);

  // --- Disconnect ---
  const disconnect = useCallback(async () => {
    if (!sessionId) return;
    try {
      stateSubRef.current?.unsubscribe();
      stateSubRef.current = null;
      await dmk.disconnect({ sessionId });
    } catch (err) {
      console.error("Disconnect error:", err);
    } finally {
      setSessionId(null);
      setDeviceState(null);
      setEoaAddress(null);
      setAccountStatus("unknown");
      setConnectionStatus("disconnected");
      setError(null);
    }
  }, [sessionId]);

  const value = useMemo<LedgerContextValue>(
    () => ({
      dmk,
      connectionStatus,
      sessionId,
      deviceState,
      signer,
      error,
      eoaAddress,
      accountStatus,
      connect,
      disconnect,
      refreshAccountStatus,
    }),
    [
      connectionStatus,
      sessionId,
      deviceState,
      signer,
      error,
      eoaAddress,
      accountStatus,
      connect,
      disconnect,
      refreshAccountStatus,
    ],
  );

  return (
    <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
  );
}
