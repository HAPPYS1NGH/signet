import { agentsCollection } from "@/lib/db";
import type { NextRequest } from "next/server";

// GET /api/agents?account=0x... — list all agents for a given account
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const account = url.searchParams.get("account");

    if (!account) {
      return Response.json(
        { error: "Missing required query param: account" },
        { status: 400 },
      );
    }

    const col = await agentsCollection();
    const agents = await col
      .find({ account: account.toLowerCase() })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    return Response.json({ agents });
  } catch (err) {
    console.error("[agents GET] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
