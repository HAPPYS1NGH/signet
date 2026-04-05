# Signet — AI Agent Authorization with Ledger Hardware Signing

Signet is a Next.js application that demonstrates how a user can authorize an AI agent to act on their behalf on-chain, with a Ledger hardware wallet as the root of trust. The user sets granular spend limits and call restrictions; the agent operates autonomously within those limits and asks the user to sign on Ledger when it needs to exceed them.

Built on Base Sepolia using EIP-7702, ERC-4337 (Account Abstraction), and the JAW smart account.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Ledger Hardware Wallet                  │
│  Signs EIP-7702 auth · Signs UserOperations · Approves    │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    Signet Web App (Next.js)                │
│                                                           │
│  1. Connect Ledger                                        │
│  2. EIP-7702 delegation → JAW Smart Account               │
│  3. Grant Permission (on-chain, signed by Ledger)         │
│  4. Monitor Agent Activity / Approve overruns             │
└──────────┬───────────────────────────┬───────────────────┘
           │                           │
           ▼                           ▼
┌─────────────────────┐   ┌───────────────────────────────┐
│  AI Agent (OpenAI)  │   │  JAW Bundler / Entry Point     │
│  scripts/openaiAgent│   │  ERC-4337 UserOp submission    │
│  Natural language   │   │  Base Sepolia (84532)          │
│  → ETH / USDC / swap│   └───────────────────────────────┘
└─────────────────────┘
```

---

## How It Works — Step by Step

### 1. Ethereum App on Ledger

The Ledger device is connected via the [Ledger Device Management Kit](https://developers.ledger.com/docs/device-app/introduction) (`@ledgerhq/device-management-kit`). The app communicates with the Ledger Ethereum app through a `signer` object that exposes:

- `signDelegationAuthorization` — signs an EIP-7702 type 4 authorization tuple
- `signTypedData` — signs EIP-712 typed data (used for UserOperation signing)
- `signTransaction` — signs raw legacy/EIP-1559 transactions

The derivation path is `44'/60'/0'/0/11` (slot 11 on the Ethereum app). Connection state is managed globally via a React context (`LedgerProvider`), making the `signer` and `eoaAddress` available throughout the app.

```
lib/ledger/
├── context.tsx   — React context, connects Ledger via DMK
├── hooks.ts      — useLedger() hook
└── types.ts      — ConnectionStatus, AccountStatus types
```

### 2. EIP-7702 Delegation → Smart Account Upgrade

When you click **"Upgrade to Smart Account"**, the app:

1. Reads the current nonce from the Ledger EOA on-chain.
2. Builds an EIP-7702 type 4 authorization that delegates the EOA's code to the JAW Account implementation (`0xbb4f7d...`). The authorization is signed directly on the Ledger hardware.
3. Builds a type 4 transaction that self-calls `addOwnerAddress(PERMISSIONS_MANAGER)` — adding the JAW Permissions Manager (`0xf1b40E...`) as an owner of the smart account in the same transaction as the delegation.
4. Signs the full transaction on Ledger (a second signature on the device).
5. Broadcasts the signed transaction and waits for confirmation.

After this, the EOA has code attached (starts with `0xef0100...`), meaning it now behaves as a smart contract account while remaining an EOA.

```
lib/account/delegation.ts
app/components/DelegationFlow.tsx
```

### 3. Grant Permission — Session Key Authorization

Once the account is a smart account, you grant an AI agent (identified by its EOA address) a bounded on-chain permission. The UI lets you configure:

| Parameter | Description |
|---|---|
| Agent wallet address | The EOA that will execute on your behalf |
| Duration | How long the permission is valid (hours) |
| Target contract | Which contracts the agent may call (or wildcard) |
| Function selector | Which functions the agent may call |
| Spend limit | Maximum token spend per time period |
| Spend period | Per minute / hour / day / week / month / one-time |
| Token | Native ETH or any ERC-20 |

Granting a permission:

1. Builds a `Permission` struct and encodes a call to `PermissionsManager.approve(permission)`.
2. Wraps it in an ERC-4337 `UserOperation`.
3. Signs the UserOperation typed data on Ledger (`signTypedData` with the ERC-4337 EIP-712 domain).
4. Submits the UserOp through the JAW bundler to the EntryPoint (`0x4337084D...`).
5. Waits for the `PermissionApproved` event to extract the `permissionId`.
6. Stores the permission in the JAW relay (for off-chain lookup) and registers the agent in the app's DB.

The `permissionId` is a hash of the full permission struct and uniquely identifies the authorization.

```
lib/account/permissions.ts
app/components/GrantPermission.tsx
app/api/agents/register/route.ts
```

### 4. Agent Execution — Two Paths

Once the permission is granted, the AI agent has two execution modes:

#### Autonomous (within limits)

The agent uses the JAW SDK (`@jaw.id/core`) to submit a `UserOperation` signed with its own private key. The `PermissionsManager` validates the call on-chain against the stored permission struct (target, selector, spend limits). If valid, the UserOp executes without any user interaction.

```typescript
const account = await Account.fromLocalAccount({ chainId: 84532, apiKey: JAW_API_KEY }, spender);
const result = await account.sendCalls(
  [{ to: "0x...", value: parseEther("0.001") }],
  { permissionId: PERMISSION_ID },
);
```

The agent then logs the transaction to the app:

```
POST /api/agents/<agentId>/tx
{ "type": "autonomous", "calls": [...], "description": "...", "txHash": "0x..." }
```

#### Signature Request (exceeds limits)

When the agent needs to do something outside its permission scope, it submits a **signature request**:

```
POST /api/agents/<agentId>/tx
{ "type": "signature_request", "calls": [...], "description": "Human-readable intent" }
→ { "txId": "uuid", "status": "pending" }
```

The user sees this in the **Monitor** tab. They review the description and calls, then approve — which triggers a Ledger signing flow on the hardware device. The agent polls `GET /api/tx/<txId>` until it gets `"status": "approved"` and a `txHash`.

```
app/api/agents/[agentId]/route.ts
app/api/tx/[txId]/route.ts
app/components/AgentActivity.tsx
```

### 5. AI Agent — Natural Language Blockchain Execution

`scripts/openaiAgent.ts` is a TypeScript agent powered by GPT-4o-mini that accepts natural language commands and routes them to the correct on-chain action:

```
you > send 0.001 ETH to 0xdead...
  → Send 0.001 ETH to 0xdead...
  ✓ Within your spend limit — executing now…

you > send 50 USDC to 0xdead...
  → Send 50 USDC to 0xdead...
  ⚠ This exceeds your spend limit.
  Sending approval request to the Signet dashboard…
  Open http://localhost:3000 → Monitor tab → Approve & Sign on Ledger
```

Supported intents:
- `transfer_eth` — send native ETH to an address
- `transfer_usdc` — send USDC tokens to an address
- `swap_eth_to_usdc` — swap ETH for USDC via Uniswap
- `clarify` — asks for missing info (address, amount)
- `unsupported` — graceful refusal

The agent runs as an interactive REPL or accepts a single command:

```bash
# REPL mode
npx tsx scripts/openaiAgent.ts

# Single-shot
npx tsx scripts/openaiAgent.ts "swap eth to usdc"
```

### 6. agent.md — Skill File for Other AI Agents

`public/agent.md` is a machine-readable instruction file for any AI agent that has been granted permissions via Signet. It describes:

- How to execute autonomously using `@jaw.id/core` within the granted permission
- How to request user signatures for out-of-scope operations via the REST API
- The polling pattern for waiting on Ledger approval
- Guidelines: prefer autonomous, be descriptive, don't spam requests

Any AI agent (Claude, GPT, or any agent that loads skills from URLs) can fetch this file to understand how to operate with a granted permission.

```
public/agent.md    (hosted at /agent.md)
```

### 7. ERC-7730 Clear Signing — What You See on the Ledger

When the user signs anything on their Ledger device, the screen shows human-readable fields instead of raw hex. This is implemented via [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) metadata descriptors in `registry/jaw/`.

Three descriptor files cover the full JAW protocol:

#### `calldata-jaw-account.json`
Describes the JAW Smart Account contract functions:
- `execute` → shows **To**, **Value**, **Call** (decoded recursively)
- `executeBatch` → shows each call in the batch
- `addOwnerAddress` → shows **New owner**

#### `calldata-jaw-permissions-manager.json`
Describes the Permissions Manager contract:
- `approve` → shows **Account**, **Agent**, **Valid from**, **Expires**, allowed contracts, spending limits with human-readable period names (`Per Day`, `Per Month`, etc.)
- `revoke` → shows **Account** and **Agent**
- `executeBatch` → shows the permission context alongside the calls being executed

#### `eip712-jaw-useroperation.json`
Describes the EIP-712 typed data for signing `PackedUserOperation`:
- Shows **Smart Account** address and the decoded **Operation** (calldata decoded against the account's ABI)
- Hides gas fields (`nonce`, `accountGasLimits`, `preVerificationGas`, etc.) to keep the screen focused on what matters

The descriptors are validated against the official ERC-7730 v1 JSON schema:

```bash
node registry/validate.mjs
# ✅ jaw/eip712-jaw-useroperation.json — valid
# ✅ jaw/calldata-jaw-permissions-manager.json — valid
# ✅ jaw/calldata-jaw-account.json — valid
```

---

## Key Contracts (Base Sepolia)

| Contract | Address |
|---|---|
| JAW Account Implementation | `0xbb4f7d5418Cd8DADB61bb95561179e517572cBCd` |
| JAW Account Factory | `0x5803c076563C85799989d42Fc00292A8aE52fa9E` |
| JAW Permissions Manager | `0xf1b40E3D5701C04d86F7828f0EB367B9C90901D8` |
| ERC-4337 EntryPoint | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |

---

## Setup

### Prerequisites

- Ledger hardware wallet with the **Ethereum app** installed (enable blind signing for UserOp signing)
- Node.js 18+, pnpm

### Installation

```bash
pnpm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_JAW_API_KEY=        # JAW API key (get from jaw.id)
SPENDER_PRIVATE_KEY=            # Private key of the agent EOA
PERMISSION_ID=                  # Set after granting permission in the UI
OPEN_AI_API_KEY=                # OpenAI key (for the AI agent)
API_BASE=http://localhost:3000  # Optional override for script API calls
```

### Run the App

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Demo Flow

Run these steps in order:

1. **Connect Ledger** — plug in your device and open the Ethereum app. Click **Connect** in the UI.

2. **Upgrade to Smart Account** — click **Upgrade to EIP-7702**. Confirm the delegation authorization on Ledger (first prompt), then confirm the transaction (second prompt).

3. **Grant Permission** — fill in the agent wallet address, set a spend limit (e.g. 0.01 ETH per day), and click **Sign & Grant Permission**. Confirm on Ledger. Copy the `PERMISSION_ID` and `agentId` shown after success.

4. **Update `.env.local`** with `PERMISSION_ID` and `SPENDER_PRIVATE_KEY` for the agent EOA.

5. **Run the AI agent REPL** (keep `pnpm dev` running):

   ```bash
   npx tsx scripts/openaiAgent.ts
   ```

   Try: `send 0.001 ETH to 0x...` — executes autonomously within the spend limit.

6. **Trigger an approval request** — send an amount above your spend limit, or run:

   ```bash
   npx tsx scripts/exceedLimitRequest.ts
   ```

7. **Approve on the dashboard** — go to the **Monitor** tab, review the pending request, and click **Approve**. Confirm the signature on Ledger. The agent receives the `txHash` and completes.

---

## Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── agents/
│   │   │   ├── register/       # POST — register agent after permission grant
│   │   │   └── [agentId]/      # GET activity, POST tx log / signature request
│   │   └── tx/[txId]/          # GET tx status, POST approval
│   └── components/
│       ├── DeviceConnect.tsx    # Ledger connection UI
│       ├── DelegationFlow.tsx   # EIP-7702 upgrade flow
│       ├── GrantPermission.tsx  # Permission grant form + signing
│       ├── AgentActivity.tsx    # Real-time agent activity monitor
│       └── SendTransaction.tsx  # Manual tx sending (testing)
├── lib/
│   ├── ledger/                  # DMK integration, React context
│   └── account/
│       ├── delegation.ts        # EIP-7702 tx building + broadcast
│       ├── permissions.ts       # Permission struct building, permissionId extraction
│       └── userOp.ts            # UserOperation building, gas estimation, submission
├── registry/
│   └── jaw/                     # ERC-7730 clear signing descriptors
│       ├── calldata-jaw-account.json
│       ├── calldata-jaw-permissions-manager.json
│       ├── eip712-jaw-useroperation.json
│       └── validate.mjs         # Validates descriptors against ERC-7730 v1 schema
├── scripts/
│   ├── openaiAgent.ts           # AI agent REPL (natural language → on-chain)
│   ├── executeWithPermission.ts # Execute within granted permission
│   └── exceedLimitRequest.ts    # Simulate out-of-scope request (triggers approval)
└── public/
    └── agent.md                 # Machine-readable skill for AI agents
```
