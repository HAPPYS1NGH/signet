"use client";

import { LedgerProvider, useLedger } from "@/lib/ledger";
import { SignetLanding } from "./components/SignetLanding";
import { SignetDashboard } from "./components/SignetDashboard";

function SignetApp() {
  const { connectionStatus } = useLedger();
  const isConnected = connectionStatus === "connected";
  return isConnected ? <SignetDashboard /> : <SignetLanding />;
}

export default function Home() {
  return (
    <LedgerProvider>
      <SignetApp />
    </LedgerProvider>
  );
}
