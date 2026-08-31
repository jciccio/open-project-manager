import { NextRequest, NextResponse } from "next/server";
import { MCP_TOOLS, executeMcpTool } from "@/mcp/core";
import { getApiSession } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    success: true,
    count: MCP_TOOLS.length,
    tools: MCP_TOOLS,
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getApiSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const toolName = body.tool || body.name;
    if (!toolName) {
      return NextResponse.json(
        { success: false, error: "Missing required 'tool' or 'name' field in request body." },
        { status: 400 }
      );
    }

    const args = body.arguments || body.args || {};

    const result = await executeMcpTool(toolName, args, { userId: session.userId });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("MCP Tool Execution Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to execute MCP tool",
      },
      { status: 500 }
    );
  }
}
