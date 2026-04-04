import { agentsCollection, txCollection, type TxDoc } from "@/lib/db";
import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

// POST - Agent submits a tx (autonomous log or signature request)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    // Verify agent exists
    const agents = await agentsCollection();
    const agent = await agents.findOne({ agentId });
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json();
    const { type, calls, description } = body;

    if (!type || !calls || !description) {
      return Response.json(
        { error: "Missing required fields: type, calls, description" },
        { status: 400 },
      );
    }

    if (!["autonomous", "signature_request"].includes(type)) {
      return Response.json(
        { error: "type must be 'autonomous' or 'signature_request'" },
        { status: 400 },
      );
    }

    const txId = randomUUID();
    const now = new Date();

    const doc: TxDoc = {
      txId,
      agentId,
      type,
      status: type === "autonomous" ? "executed" : "pending",
      calls,
      description,
      userOpHash: body.userOpHash ?? null,
      txHash: body.txHash ?? null,
      signature: null,
      createdAt: now,
      updatedAt: now,
    };

    const txs = await txCollection();
    await txs.insertOne(doc);

    return Response.json({ txId, status: doc.status });
  } catch (err) {
    console.error("[tx POST] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET - Get transactions for an agent (webapp polls this)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    // Verify agent exists
    const agents = await agentsCollection();
    const agent = await agents.findOne({ agentId });
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    const txs = await txCollection();
    const filter: Record<string, string> = { agentId };
    if (status) filter.status = status;

    const transactions = await txs
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return Response.json({ transactions });
  } catch (err) {
    console.error("[tx GET] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
