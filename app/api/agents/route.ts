import { agentsCollection } from "@/lib/db";
import type { NextRequest } from "next/server";

// GET /api/agents?account=0x...          — list all agents for an account
// GET /api/agents?permissionId=0x...     — look up agent by permission ID (used by agent scripts)
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const account      = url.searchParams.get("account");
    const permissionId = url.searchParams.get("permissionId");

    if (!account && !permissionId) {
      return Response.json(
        { error: "Missing query param: account or permissionId" },
        { status: 400 },
      );
    }

    const col = await agentsCollection();

    // Single agent lookup by permissionId
    if (permissionId) {
      const agent = await col.findOne({ permissionId });
      if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }
      return Response.json({ agent });
    }

    // List all agents for an account
    const agents = await col
      .find({ account: account!.toLowerCase() })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    return Response.json({ agents });
  } catch (err) {
    console.error("[agents GET] Error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
