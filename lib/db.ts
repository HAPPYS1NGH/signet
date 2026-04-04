import { MongoClient, type Db, type Collection } from "mongodb";

const DB_NAME = "ledger_agent";

const globalWithMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise(): Promise<MongoClient> {
  if (globalWithMongo._mongoClientPromise) {
    return globalWithMongo._mongoClientPromise;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  const client = new MongoClient(uri);
  const promise = client.connect();
  globalWithMongo._mongoClientPromise = promise;
  return promise;
}

export async function getDb(): Promise<Db> {
  const c = await getClientPromise();
  return c.db(DB_NAME);
}

// --- Collection Types ---

export interface StoredCallPermission {
  target: string;
  selector: string;
  checker: string;
}

export interface StoredSpendLimit {
  token: string;
  allowance: string; // hex string of bigint
  unit: string;
  multiplier: number;
}

export interface StoredPermission {
  account: string;
  spender: string;
  start: number;
  end: number;
  salt: string; // hex string of bigint
  calls: StoredCallPermission[];
  spends: StoredSpendLimit[];
}

export interface AgentDoc {
  agentId: string;
  account: string;          // smart account address (owner)
  agentAddress: string;     // agent's EOA (spender)
  permissionId: string;     // on-chain permission hash
  permission: StoredPermission; // full permission struct
  delegationTxHash: string | null; // tx hash of delegation
  status: "active" | "revoked";
  createdAt: Date;
  updatedAt: Date;
}

export interface TxDoc {
  txId: string;
  agentId: string;
  type: "autonomous" | "signature_request";
  status: "executed" | "pending" | "approved" | "rejected" | "failed";
  calls: { to: string; value: string; data?: string }[];
  description: string;
  userOpHash: string | null;
  txHash: string | null;
  signature: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function agentsCollection(): Promise<Collection<AgentDoc>> {
  const db = await getDb();
  return db.collection<AgentDoc>("agents");
}

export async function txCollection(): Promise<Collection<TxDoc>> {
  const db = await getDb();
  return db.collection<TxDoc>("transactions");
}
