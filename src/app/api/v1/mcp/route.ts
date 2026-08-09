import { NextResponse } from "next/server";
import { MCP_TOOLS } from "@/mcp/core";

export async function GET() {
  return NextResponse.json({
    status: "online",
    name: "Open Project Manager MCP Server",
    version: "1.0.0",
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: { count: MCP_TOOLS.length },
      resources: { enabled: true },
      prompts: { enabled: true },
    },
    endpoints: {
      tools: "/api/v1/mcp/tools",
      resources: "/api/v1/mcp/resources",
      jsonrpc: "/api/v1/mcp/jsonrpc",
    },
  });
}
