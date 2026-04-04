"use client";

import { LedgerProvider, useLedger } from "@/lib/ledger";
import { DeviceConnect } from "./DeviceConnect";
import { DeviceInfo } from "./DeviceInfo";
import { AccountStatusCard } from "./AccountStatus";
import { DelegationFlow } from "./DelegationFlow";
import { SendTransaction } from "./SendTransaction";

function DashboardContent() {
  const { accountStatus } = useLedger();

  return (
    <div className="flex flex-col gap-6">
      <DeviceConnect />
      <DeviceInfo />
      <AccountStatusCard status={accountStatus} />
      <DelegationFlow />
      <SendTransaction />
    </div>
  );
}

export function LedgerDashboard() {
  return (
    <LedgerProvider>
      <DashboardContent />
    </LedgerProvider>
  );
}
