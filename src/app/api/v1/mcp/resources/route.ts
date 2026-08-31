import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { readMcpResource } from "@/mcp/core";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const uri = searchParams.get("uri");

  if (!uri) {
    return NextResponse.json({
      success: true,
      resources: [
        {
          uri: "opm://projects",
          name: "All Workspace Projects",
          mimeType: "application/json",
          description: "List of active projects in Open Project Manager",
        },
      ],
    });
  }

  try {
    const resource = await readMcpResource(uri, session.userId);
    return NextResponse.json({
      success: true,
      uri: resource.uri,
      mimeType: resource.mimeType,
      data: resource.data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to read MCP resource" },
      { status: 404 }
    );
  }
}
