import { createPublicClient, http } from "viem";
import { CHAIN, BUNDLER_URL } from "./config";

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(),
});

// Bundler JSON-RPC — called directly since we build UserOps manually
export async function bundlerRpc(method: string, params: unknown[]): Promise<unknown> {
  const body = { jsonrpc: "2.0", id: 1, method, params };

  console.log(`[bundlerRpc] ${method} →`, JSON.stringify(body, null, 2));

  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`[bundlerRpc] ${method} ← ${res.status}`, text);

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Bundler: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || json.error) {
    const err = json.error as Record<string, unknown> | undefined;
    const errMsg = err?.message ?? err?.data ?? JSON.stringify(err) ?? `HTTP ${res.status}`;
    throw new Error(`Bundler: ${errMsg}`);
  }

  return json.result;
}
