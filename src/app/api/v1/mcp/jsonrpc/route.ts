import { NextRequest, NextResponse } from "next/server";
import { MCP_TOOLS, executeMcpTool } from "@/mcp/core";
import { getApiSession } from "@/lib/auth";
import { db } from "@/lib/db";

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
        const toolName = params?.name;
        const args = params?.arguments || {};
        if (session && !args.userId) args.userId = session.userId;

        try {
          const result = await executeMcpTool(toolName, args);
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
        const uri = params?.uri;
        if (uri === "opm://projects") {
          const projects = await db.project.findMany({
            where: { isArchived: false },
          });
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(projects, null, 2),
                },
              ],
            },
          });
        }
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Resource non-existent: ${uri}` },
        });
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
