# Ledger Agent Permission Skill

You have access to a Ledger hardware wallet signing service. A user has granted you on-chain permissions to act on their behalf via their smart account. For operations **within** your granted permission, you can execute directly using `@jaw.id/core`. For operations **outside** your permission scope, you can request the user to sign via their Ledger device.

## Your Credentials

- **Agent ID**: `<AGENT_ID>` (provided by the user)
- **API Base URL**: `<BASE_URL>` (e.g., `https://ledger-app.vercel.app`)
- **Permission ID**: `<PERMISSION_ID>` (your on-chain permission hash)
- **Your Private Key**: Used with `@jaw.id/core` for autonomous execution

## How Permissions Work

The user granted you an on-chain permission with specific constraints:
- **Allowed call targets**: Which contracts you can interact with
- **Allowed function selectors**: Which functions you can call
- **Spend limits**: How much you can spend per time period
- **Expiry**: When your permission expires

Operations within these constraints can be executed autonomously. Operations outside require user approval.

## Autonomous Execution (Within Permission)

Use `@jaw.id/core` to execute calls directly:

```typescript
import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";

const spender = privateKeyToAccount(SPENDER_PRIVATE_KEY);
const account = await Account.fromLocalAccount(
  { chainId: 84532, apiKey: JAW_API_KEY },
  spender,
);

const result = await account.sendCalls(
  [{ to: "0x...", value: parseEther("0.001") }],
  { permissionId: PERMISSION_ID },
);
```

After executing, log the transaction:

```
POST <BASE_URL>/api/agents/<AGENT_ID>/tx
Content-Type: application/json

{
  "type": "autonomous",
  "calls": [{ "to": "0x...", "value": "1000000000000000", "data": "0x" }],
  "description": "Sent 0.001 ETH to 0xdead...",
  "txHash": "0x..."
}
```

## Requesting User Signature (Outside Permission)

When you need to perform an action outside your granted permission:

### Step 1: Submit a signature request

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
  "description": "Human-readable description of what this transaction does"
}
```

Response:
```json
{ "txId": "uuid-here", "status": "pending" }
```

### Step 2: Poll for the result

```
GET <BASE_URL>/api/tx/<txId>
```

Response when pending:
```json
{ "txId": "...", "status": "pending", "signature": null }
```

Response when approved:
```json
{ "txId": "...", "status": "approved", "signature": "0x..." }
```

Response when rejected:
```json
{ "txId": "...", "status": "rejected", "signature": null }
```

Poll every 5-10 seconds. The user will see the request on their webapp and can approve (signing with their Ledger) or reject.

## Guidelines

1. Always prefer autonomous execution when within your permission scope
2. Write clear, human-readable descriptions for signature requests — the user sees these
3. Include the full call details (to, value, data) so the user can verify what they're signing
4. Handle rejection gracefully — inform the user why the action was needed
5. Do not spam signature requests — batch related calls when possible
6. Values are in wei (as strings) — use `parseEther` to convert from ETH
