import { txCollection } from "@/lib/db";
import type { NextRequest } from "next/server";

// GET - Agent polls this for signature result
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ txId: string }> },
) {
  try {
    const { txId } = await params;

    const txs = await txCollection();
    const tx = await txs.findOne({ txId });

    if (!tx) {
      return Response.json({ error: "Transaction not found" }, { status: 404 });
    }

    return Response.json({
      txId: tx.txId,
      status: tx.status,
      signature: tx.signature,
      userOpHash: tx.userOpHash,
      txHash: tx.txHash,
    });
  } catch (err) {
    console.error("[tx GET] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
