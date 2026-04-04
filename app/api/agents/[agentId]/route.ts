import { agentsCollection } from "@/lib/db";
import type { NextRequest } from "next/server";

// GET /api/agents/[agentId] — get a single agent's details
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    const col = await agentsCollection();
    const agent = await col.findOne({ agentId });

    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    return Response.json({
      agentId: agent.agentId,
      account: agent.account,
      agentAddress: agent.agentAddress,
      permissionId: agent.permissionId,
      permission: agent.permission,
      delegationTxHash: agent.delegationTxHash,
      status: agent.status,
      createdAt: agent.createdAt,
    });
  } catch (err) {
    console.error("[agent GET] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
