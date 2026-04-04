import { txCollection } from "@/lib/db";
import type { NextRequest } from "next/server";

// POST - Webapp submits approval/rejection with optional signature
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ txId: string }> },
) {
  try {
    const { txId } = await params;
    const body = await request.json();
    const { approved, signature, txHash } = body;

    if (typeof approved !== "boolean") {
      return Response.json(
        { error: "Missing required field: approved (boolean)" },
        { status: 400 },
      );
    }

    const txs = await txCollection();
    const tx = await txs.findOne({ txId });

    if (!tx) {
      return Response.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (tx.status !== "pending") {
      return Response.json(
        { error: `Transaction already ${tx.status}` },
        { status: 409 },
      );
    }

    const update: Record<string, unknown> = {
      status: approved ? "approved" : "rejected",
      updatedAt: new Date(),
    };

    if (approved && signature) update.signature = signature;
    if (approved && txHash) update.txHash = txHash;

    await txs.updateOne({ txId }, { $set: update });

    return Response.json({
      txId,
      status: update.status,
    });
  } catch (err) {
    console.error("[respond] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
