import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { readMcpResource } from "@/mcp/core";
import { isPublicError, publicErrorMessage } from "@/mcp/errors";
import { MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from "@/mcp/resourceCatalog";

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
      resources: MCP_RESOURCES,
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
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
  } catch (error) {
    return NextResponse.json(
      { success: false, error: publicErrorMessage(error, `resource ${uri}`) },
      { status: isPublicError(error) ? 404 : 500 }
    );
  }
}
