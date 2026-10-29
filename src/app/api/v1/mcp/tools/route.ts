import { NextRequest, NextResponse } from "next/server";
import { MCP_TOOLS, executeMcpTool, isKnownMcpTool } from "@/mcp/core";
import { isPublicError, publicErrorMessage } from "@/mcp/errors";
import { getApiSession } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    success: true,
    count: MCP_TOOLS.length,
    tools: MCP_TOOLS,
  });
}

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const toolName = body?.tool || body?.name;
  if (!toolName) {
    return NextResponse.json(
      { success: false, error: "Missing required 'tool' or 'name' field in request body." },
      { status: 400 }
    );
  }
  if (!isKnownMcpTool(toolName)) {
    return NextResponse.json({ success: false, error: `Unknown tool: ${toolName}` }, { status: 400 });
  }

  const args = body.arguments || body.args || {};

  try {
    const result = await executeMcpTool(toolName, args, { userId: session.userId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: publicErrorMessage(error, `tool ${toolName}`) },
      { status: isPublicError(error) ? 400 : 500 }
    );
  }
}
