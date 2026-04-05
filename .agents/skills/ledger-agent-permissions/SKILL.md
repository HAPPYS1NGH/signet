---
name: ledger-agent-permissions
description: >
  Use this skill when working with agent permissions in the ledger-app project.
  Applies when: setting up a new agent permission, configuring .env with PERMISSION_ID
  or SPENDER_PRIVATE_KEY, writing scripts that use executeWithPermission or
  requestAuthorisation patterns, understanding how to grant permissions via the webapp,
  determining which contract address / function selector / spend limit to configure,
  debugging permission execution failures, or building new agent scripts that act
  autonomously or request user approval via Ledger.
---

# Ledger Agent Permissions

This project lets an **agent** (identified by a private key) act on behalf of a user's JAW smart account. The user grants the agent a permission on-chain via the webapp. The agent can then either:

1. **Execute autonomously** — within the granted permission scope (no user interaction)
2. **Request approval** — for actions outside the permission scope (user signs on their Ledger)

---

## Architecture Overview

```
User (Ledger)
  └─ JAW Smart Account  (owns assets)
       └─ Permission granted to →  Agent Wallet (EOA with SPENDER_PRIVATE_KEY)
                                        └─ executes calls via PERMISSION_ID
                                        └─ OR posts signature_request to webapp for manual Ledger approval
```

**Chain:** Base Sepolia (chainId: `84532`)  
**Webapp:** `https://signet-jet.vercel.app/` (dev) or deployed URL  
**DB:** MongoDB — stores agents, permissions, and tx records  

---

## Environment Variables

All of these live in `.env` at the project root:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_JAW_API_KEY` | ✅ | JAW SDK API key from [dashboard.jaw.id](https://dashboard.jaw.id) |
| `SPENDER_PRIVATE_KEY` | ✅ | Agent's EOA private key (hex, `0x...`) — the identity that was granted the permission |
| `PERMISSION_ID` | ✅ | The on-chain permission hash (`0x...`) returned from `grantPermissions` |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `OPEN_AI_API_KEY` | Optional | Only if using the AI agent (openaiAgent.ts) |
| `API_BASE` | Optional | Webapp base URL (default: `https://signet-jet.vercel.app/`) |

### How to get these values

- **`NEXT_PUBLIC_JAW_API_KEY`**: From [dashboard.jaw.id](https://dashboard.jaw.id)
- **`SPENDER_PRIVATE_KEY`**: Generate a fresh EOA — e.g. `cast wallet new` or any wallet generator. This is the agent's wallet.
- **`PERMISSION_ID`**: Obtained after the user grants a permission via the webapp **GrantPermission** panel. The returned `permissionId` goes here.

---

## Step-by-Step: Granting a Permission

This happens in the webapp (Next.js app, `app/components/GrantPermission`).

### 1. User connects their JAW smart account via passkey (Ledger + JAW)

### 2. Fill in the GrantPermission form:

| Field | Description | Example |
|---|---|---|
| **Agent wallet address** | The spender's smart account address (derived from `SPENDER_PRIVATE_KEY`) | `0x...` |
| **Permission duration** | How long the permission is valid | `24 hours`, `7 days` |
| **Call target (contract)** | Contract the agent is allowed to call | See table below |
| **Function selector** | The specific function allowed | See table below |
| **Spend limit token** | Token contract address for spend-cap | See table below |
| **Spend limit amount** | Max spendable in the period (human-readable) | `100` |
| **Spend period** | Reset period | `day`, `week`, `month`, `forever` |

### Common Permission Configurations

#### ETH Transfers (native)
| Field | Value |
|---|---|
| Target contract | *(any address or leave unrestricted)* |
| Function selector | `0x` or leave blank |
| Spend limit token | Native ETH |
| Spend limit amount | e.g. `0.01` (ETH/day) |

#### USDC Transfers (ERC-20)
| Field | Value |
|---|---|
| Target contract | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (USDC, Base Sepolia) |
| Function selector | `0xa9059cbb` (`transfer(address,uint256)`) |
| Spend limit token | Custom → `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Spend limit amount | e.g. `100` (USDC) |

#### Uniswap V3 ETH→USDC Swap
| Field | Value |
|---|---|
| Target contract | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` (SwapRouter02, Base Sepolia) |
| Function selector | `0x5023b4df` (`multicall(bytes[])`) |
| Spend limit token | WETH → `0x4200000000000000000000000000000000000006` |
| Spend limit amount | e.g. `0.01` |

### 3. Submit → the webapp calls `grantPermissions` via JAW SDK and registers the agent in MongoDB

The returned `permissionId` must be saved to `.env` as `PERMISSION_ID`.

---

## Executing With a Permission (Autonomous)

Use when the action **is within** the granted permission scope.

**Script:** `scripts/executeWithPermission.ts` (ETH) or `scripts/transferUsdc.ts` (USDC)

```typescript
import { Account } from "@jaw.id/core";
import { privateKeyToAccount } from "viem/accounts";

const spenderLocal = privateKeyToAccount(SPENDER_PRIVATE_KEY);
const account = await Account.fromLocalAccount(
  { chainId: 84532, apiKey: JAW_API_KEY },
  spenderLocal,
);

// Execute call using the permission
const result = await account.sendCalls(calls, {
  permissionId: PERMISSION_ID,
});

// Wait for confirmation
const status = account.getCallStatus(result.id);
// status.status === 200 means confirmed
// status.receipts[0].transactionHash has the txHash
```

**Key rules:**
- `calls` is `Array<{ to: Address, value?: bigint, data?: Hex }>`
- For ERC-20 transfers: use `encodeFunctionData` for `data`, set `value` to `0n`
- For ETH transfers: set `value` in wei (bigint), `data` can be `"0x"`
- After execution, always log to DB via `POST /api/agents/:agentId/tx`

### Logging to DB after autonomous execution

```typescript
await fetch(`${API_BASE}/api/agents/${agentId}/tx`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "autonomous",
    calls: [{ to, value: value.toString(), data }],
    description: "Human-readable description",
    userOpHash: result.id,
    txHash,  // from getCallStatus receipt
  }),
});
```

---

## Requesting User Approval (Over-Limit / Outside Permission)

Use when the action **exceeds** permission scope or requires manual Ledger approval.

**Scripts:** `scripts/requestAuthorisation.ts`, `scripts/requestUsdcTransfer.ts`, `scripts/exceedLimitRequest.ts`

### Step 1: Post a `signature_request`

```typescript
const res = await fetch(`${API_BASE}/api/agents/${agentId}/tx`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "signature_request",
    calls: [{ to, value: amount.toString(), data }],
    description: "Clear human-readable description for the user",
  }),
});
const { txId } = await res.json();
```

### Step 2: Poll for user decision

```typescript
// Poll GET /api/tx/:txId every 3-5 seconds
const res = await fetch(`${API_BASE}/api/tx/${txId}`);
const { status, txHash } = await res.json();
// status: "pending" | "approved" | "rejected" | "executed" | "failed"
```

### Step 3: If approved, execute on-chain

```typescript
const result = await account.sendCalls(calls, { permissionId: PERMISSION_ID });
```

### Step 4: Update DB with result

```typescript
await fetch(`${API_BASE}/api/tx/${txId}/respond`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ approved: true, txHash }),
});
```

---

## Resolving agentId Automatically

You never need to hardcode `agentId`. Resolve it from the DB using `PERMISSION_ID`:

```typescript
async function resolveAgentId(permissionId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agents?permissionId=${permissionId}`);
  if (res.status === 404) throw new Error("No agent found — grant the permission first");
  const { agent } = await res.json();
  return agent.agentId;
}
```

---

## Running the Scripts

```bash
# Run with dotenv loaded from .env
npx tsx scripts/executeWithPermission.ts       # autonomous ETH transfer
npx tsx scripts/transferUsdc.ts                # autonomous USDC transfer
npx tsx scripts/requestAuthorisation.ts        # ETH transfer requiring Ledger sign
npx tsx scripts/requestUsdcTransfer.ts         # USDC transfer requiring Ledger sign
npx tsx scripts/exceedLimitRequest.ts          # over-limit → escalates to Ledger
```

Override env vars per-run:
```bash
USDC_AMOUNT=5 USDC_RECIPIENT=0x... npx tsx scripts/transferUsdc.ts
AMOUNT_ETH=0.05 npx tsx scripts/exceedLimitRequest.ts
```

---

## API Routes Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/agents?permissionId=0x...` | Look up agent by permissionId |
| `GET` | `/api/agents/:agentId` | Get agent details by agentId |
| `GET` | `/api/agents?account=0x...` | List all agents for a smart account |
| `POST` | `/api/agents/:agentId/tx` | Submit a tx (autonomous or signature_request) |
| `GET` | `/api/tx/:txId` | Poll tx status |
| `POST` | `/api/tx/:txId/respond` | Update tx with txHash after execution |

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| ERC-20 transfer with `value` set to token amount | Use `encodeFunctionData` for ERC-20; `value` must be `0n` |
| Hardcoding agentId | Always resolve via `GET /api/agents?permissionId=...` |
| `PERMISSION_ID` doesn't match what was granted | Re-grant in webapp and copy the new permissionId |
| Permission expired | Re-grant in webapp with longer duration |
| Spend limit exceeded | Either request Ledger approval or re-grant a higher limit |
| Function selector mismatch | Ensure selector in permission matches what script calls |

---

## Decision Tree: Autonomous vs Approval

```
Agent wants to execute a call
  ├─ Is it within the permission's allowed targets & spend limit?
  │     YES → account.sendCalls(calls, { permissionId }) → log to DB
  │     NO  → POST signature_request → poll for decision → if approved, sendCalls
  └─ Is the permission still valid (not expired)?
        YES → proceed
        NO  → ask user to re-grant permission in webapp
```
