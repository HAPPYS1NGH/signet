"use client";

import { useContext } from "react";
import { LedgerContext } from "./context";
import type { LedgerContextValue } from "./types";

export function useLedger(): LedgerContextValue {
  const ctx = useContext(LedgerContext);
  if (!ctx) {
    throw new Error("useLedger must be used within a <LedgerProvider>");
  }
  return ctx;
}
