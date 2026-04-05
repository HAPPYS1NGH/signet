# Signet Agent Skill

You have access to a Ledger hardware wallet signing service. A user has granted you on-chain permissions to act on their behalf via their JAW smart account on Base Sepolia. For operations **within** your granted permission you can execute directly. For operations **outside** your permission scope you can request the user to sign via their Ledger device.

## Your Credentials

These values are provided by the user when they grant you a permission:

- **Agent ID**: `<AGENT_ID>` — your identifier in the Signet app
- **API Base URL**: `<BASE_URL>` — e.g. `https://ledger-app.vercel.app`
- **Permission ID**: `<PERMISSION_ID>` — the on-chain permission hash
- **Your Private Key**: used with `@jaw.id/core` for autonomous execution
- **JAW API Key**: `<JAW_API_KEY>` — required by the JAW bundler

## How Permissions Work

The user granted you an on-chain permission with specific constraints enforced by the JAW Permissions Manager contract on Base Sepolia:

- **Allowed call targets** — which contracts you may interact with
- **Allowed function selectors** — which functions you may call
- **Spend limits** — maximum token spend per time period (e.g. 0.01 ETH per day)
- **Expiry** — when the permission expires

Operations within these constraints execute autonomously. Operations outside require user approval via Ledger.

---

## Autonomous Execution (Within Permission)

Use `@jaw.id/core` to execute calls directly. The bundler validates the call against the on-chain permission before submission.

```typescript
import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";

const spender = privateKeyToAccount(SPENDER_PRIVATE_KEY);
const account = await Account.fromLocalAccount(
  { chainId: 84532, apiKey: JAW_API_KEY },
  spender,
);

const result = await account.sendCalls(
  [{ to: "0xRecipient", value: parseEther("0.001") }],
  { permissionId: PERMISSION_ID },
);
```

After executing, log the transaction so it appears in the user's dashboard:

```
POST <BASE_URL>/api/agents/<AGENT_ID>/tx
Content-Type: application/json

{
  "type": "autonomous",
  "calls": [{ "to": "0x...", "value": "1000000000000000", "data": "0x" }],
  "description": "Sent 0.001 ETH to 0xdead… (user requested transfer)",
  "txHash": "0x..."
}
```

---

## Requesting User Signature (Outside Permission)

When you need to perform an action outside your granted permission, request the user's Ledger signature.

### Step 1 — Submit a signature request

```
POST <BASE_URL>/api/agents/<AGENT_ID>/tx
Content-Type: application/json

{
  "type": "signature_request",
  "calls": [
    {
      "to": "0xContractAddress",
      "value": "0",
      "data": "0xCalldata"
    }
  ],
  "description": "Send 0.05 ETH to 0xdead… — exceeds daily spend limit"
}
```

Response:

```json
{ "txId": "uuid-here", "status": "pending" }
```

### Step 2 — Poll for the result

```
GET <BASE_URL>/api/tx/<txId>
```

Poll every 5–10 seconds. The user sees the request in their dashboard and approves or rejects it. Approving triggers a Ledger signing flow; the signed transaction is submitted on-chain.

**Pending:**
```json
{ "txId": "...", "status": "pending", "txHash": null }
```

**Approved:**
```json
{ "txId": "...", "status": "approved", "txHash": "0x..." }
```

**Rejected:**
```json
{ "txId": "...", "status": "rejected", "txHash": null }
```

If rejected, inform the user why the action was needed and offer alternatives if possible. Do not resubmit the same request.

---

## Checking Your Permission Scope

You can retrieve your current permission details to decide which execution path to use:

```
GET <BASE_URL>/api/agents/<AGENT_ID>
```

Response includes spend limits, call restrictions, and expiry.

---

## Guidelines

1. **Prefer autonomous execution** when within permission scope — it is instant and requires no user interaction.
2. **Write clear descriptions** for signature requests — the user reads these on the dashboard before approving.
3. **Include full call details** (`to`, `value`, `data`) so the user can verify what they are signing.
4. **Do not spam requests** — batch related calls when possible.
5. **Handle rejection gracefully** — explain what you were trying to do and why.
6. **Values are in wei** (as strings). Use `parseEther` / `parseUnits` to convert from human-readable amounts.
7. **The permission has an expiry** — check the `end` timestamp before assuming you can still act autonomously.

---

## Supported Operations on Base Sepolia

The Signet reference agent (`scripts/openaiAgent.ts`) demonstrates these patterns:

| Action | Method | Notes |
|---|---|---|
| Send ETH | `account.sendCalls` with `value` | Autonomous if within spend limit |
| Send USDC | `account.sendCalls` with ERC-20 `transfer` calldata | Autonomous if within spend limit |
| Swap ETH → USDC | `account.sendCalls` to Uniswap router | Autonomous if within spend limit |
| Anything exceeding limits | Signature request | User approves on Ledger |
