import { agentsCollection, type AgentDoc, type StoredPermission } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { account, agentAddress, permissionId, permission, delegationTxHash } = body;

    if (!account || !agentAddress || !permissionId) {
      return Response.json(
        { error: "Missing required fields: account, agentAddress, permissionId" },
        { status: 400 },
      );
    }

    // Validate permission struct if provided
    const storedPermission: StoredPermission = permission ?? {
      account,
      spender: agentAddress,
      start: 0,
      end: 0,
      salt: "0x0",
      calls: [],
      spends: [],
    };

    const agentId = randomUUID();
    const now = new Date();

    const doc: AgentDoc = {
      agentId,
      account: account.toLowerCase(),
      agentAddress: agentAddress.toLowerCase(),
      permissionId,
      permission: storedPermission,
      delegationTxHash: delegationTxHash ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const col = await agentsCollection();
    await col.insertOne(doc);

    console.log("[register] Agent registered:", agentId, "for account:", account);

    return Response.json({ agentId, account, agentAddress, permissionId, status: "active" });
  } catch (err) {
    console.error("[register] Error:", err);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
