import { NextRequest, NextResponse } from "next/server";
import { MCP_TOOLS, executeMcpTool, isKnownMcpTool, readMcpResource } from "@/mcp/core";
import { getApiSession } from "@/lib/auth";
import { INTERNAL_ERROR_MESSAGE, isPublicError, publicErrorMessage } from "@/mcp/errors";
import { MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from "@/mcp/resourceCatalog";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const UNAUTHORIZED = -32001;

type Session = Awaited<ReturnType<typeof getApiSession>>;
type JsonRpcId = string | number | null;
type Reply = { status: number; body: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseId(message: unknown): JsonRpcId {
  const id = isPlainObject(message) ? message.id : undefined;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function result(id: JsonRpcId, value: unknown): Reply {
  return { status: 200, body: { jsonrpc: "2.0", id, result: value } };
}

function error(id: JsonRpcId, code: number, message: string, status = 200): Reply {
  return { status, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

async function handleMessage(message: unknown, session: Session): Promise<Reply | null> {
  const id = responseId(message);
  if (!isPlainObject(message) || typeof message.method !== "string") {
    return error(id, INVALID_REQUEST, "Invalid Request: missing method", 400);
  }
  const { method, params } = message;
  if (params !== undefined && !isPlainObject(params)) {
    return error(id, INVALID_REQUEST, "Invalid Request: params must be an object", 400);
  }

  // JSON-RPC notifications (no response expected), e.g. the
  // `notifications/initialized` every MCP client sends after the handshake.
  // Answering these with an error breaks the connection.
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "open-project-manager-mcp", version: "1.0.0" },
      });

    case "tools/list":
      return result(id, { tools: MCP_TOOLS });

    case "tools/call": {
      if (!session) return error(id, UNAUTHORIZED, "Unauthorized", 401);

      const toolName = params?.name;
      if (!isKnownMcpTool(toolName)) {
        return error(id, INVALID_PARAMS, `Unknown tool: ${String(toolName)}`);
      }
      const args = params?.arguments ?? {};
      if (!isPlainObject(args)) {
        return error(id, INVALID_PARAMS, "params.arguments must be an object");
      }

      try {
        const toolResult = await executeMcpTool(toolName, args, { userId: session.userId });
        return result(id, { content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }] });
      } catch (toolError) {
        return result(id, {
          isError: true,
          content: [{ type: "text", text: publicErrorMessage(toolError, `tool ${toolName}`) }],
        });
      }
    }

    case "resources/list":
      return result(id, { resources: MCP_RESOURCES });

    case "resources/templates/list":
      return result(id, { resourceTemplates: MCP_RESOURCE_TEMPLATES });

    case "resources/read": {
      if (!session) return error(id, UNAUTHORIZED, "Unauthorized", 401);

      const uri = params?.uri;
      if (typeof uri !== "string" || !uri) return error(id, INVALID_PARAMS, "params.uri is required");

      try {
        const resource = await readMcpResource(uri, session.userId);
        return result(id, {
          contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(resource.data, null, 2) }],
        });
      } catch (resourceError) {
        return isPublicError(resourceError)
          ? error(id, INVALID_PARAMS, resourceError.message)
          : error(id, INTERNAL_ERROR, publicErrorMessage(resourceError, `resource ${uri}`));
      }
    }

    default:
      return error(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(error(null, PARSE_ERROR, "Parse error").body, { status: 400 });
  }

  try {
    const session = await getApiSession(request);

    if (!Array.isArray(payload)) {
      const reply = await handleMessage(payload, session);
      return reply ? NextResponse.json(reply.body, { status: reply.status }) : new NextResponse(null, { status: 202 });
    }

    if (payload.length === 0) {
      return NextResponse.json(error(null, INVALID_REQUEST, "Invalid Request: empty batch").body);
    }
    const replies: Record<string, unknown>[] = [];
    for (const message of payload) {
      const reply = await handleMessage(message, session);
      if (reply) replies.push(reply.body);
    }
    return replies.length > 0 ? NextResponse.json(replies) : new NextResponse(null, { status: 202 });
  } catch (unexpected) {
    console.error("MCP JSON-RPC request failed:", unexpected);
    return NextResponse.json(error(null, INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE).body, { status: 500 });
  }
}
