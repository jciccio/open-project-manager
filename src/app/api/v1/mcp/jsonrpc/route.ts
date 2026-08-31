import { NextRequest, NextResponse } from "next/server";
import { MCP_TOOLS, executeMcpTool, readMcpResource } from "@/mcp/core";
import { getApiSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getApiSession(request);
    const body = await request.json();

    const { id, method, params } = body;

    if (!method) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: id ?? null,
          error: { code: -32600, message: "Invalid Request: missing method" },
        },
        { status: 400 }
      );
    }

    switch (method) {
      case "initialize":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: "open-project-manager-mcp",
              version: "1.0.0",
            },
          },
        });

      case "tools/list":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: { tools: MCP_TOOLS },
        });

      case "tools/call": {
        if (!session) {
          return NextResponse.json(
            { jsonrpc: "2.0", id, error: { code: -32001, message: "Unauthorized" } },
            { status: 401 }
          );
        }

        const toolName = params?.name;
        const args = params?.arguments || {};

        try {
          const result = await executeMcpTool(toolName, args, { userId: session.userId });
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          });
        } catch (toolError: any) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: toolError.message || String(toolError),
                },
              ],
            },
          });
        }
      }

      case "resources/list":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "opm://projects",
                name: "All Workspace Projects",
                mimeType: "application/json",
                description: "List of active projects in Open Project Manager",
              },
            ],
          },
        });

      case "resources/read": {
        if (!session) {
          return NextResponse.json(
            { jsonrpc: "2.0", id, error: { code: -32001, message: "Unauthorized" } },
            { status: 401 }
          );
        }

        const uri = params?.uri;
        try {
          const resource = await readMcpResource(uri, session.userId);
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType,
                  text: JSON.stringify(resource.data, null, 2),
                },
              ],
            },
          });
        } catch (resourceError: any) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: resourceError.message || `Resource non-existent: ${uri}` },
          });
        }
      }

      default:
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: error.message || "Internal server error" },
      },
      { status: 500 }
    );
  }
}
