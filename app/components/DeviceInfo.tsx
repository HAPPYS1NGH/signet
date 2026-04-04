"use client";

import { DeviceSessionStateType } from "@ledgerhq/device-management-kit";
import { useLedger } from "@/lib/ledger";

export function DeviceInfo() {
  const { connectionStatus, deviceState } = useLedger();

  if (connectionStatus !== "connected" || !deviceState) return null;

  const isReady =
    deviceState.sessionStateType === DeviceSessionStateType.ReadyWithoutSecureChannel ||
    deviceState.sessionStateType === DeviceSessionStateType.ReadyWithSecureChannel;

  const readyState = isReady ? deviceState : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-4 text-sm font-semibold text-zinc-100">Device Info</h2>
      <div className="grid grid-cols-2 gap-4">
        <InfoField label="Model" value={deviceState.deviceModelId} />
        <InfoField label="Status" value={deviceState.deviceStatus} />
        {deviceState.deviceName && (
          <InfoField label="Name" value={deviceState.deviceName} />
        )}
        {readyState?.currentApp && (
          <InfoField
            label="Current App"
            value={`${readyState.currentApp.name} v${readyState.currentApp.version}`}
          />
        )}
        {readyState?.firmwareVersion && (
          <InfoField label="Firmware" value={readyState.firmwareVersion.os} />
        )}
        {readyState?.batteryStatus && (
          <InfoField label="Battery" value={`${readyState.batteryStatus.level}%`} />
        )}
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-zinc-200">{value}</p>
    </div>
  );
}
