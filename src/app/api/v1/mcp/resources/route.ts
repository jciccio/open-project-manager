import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
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
    if (uri === "opm://projects") {
      const projects = await db.project.findMany({
        where: { isArchived: false },
        include: { _count: { select: { cards: true, columns: true } } },
      });
      return NextResponse.json({
        success: true,
        uri,
        mimeType: "application/json",
        data: projects,
      });
    }

    if (uri.startsWith("opm://projects/")) {
      const id = uri.replace("opm://projects/", "");
      const project = await db.project.findUnique({
        where: { id },
        include: {
          columns: {
            orderBy: { order: "asc" },
            include: { cards: true },
          },
        },
      });
      if (!project) {
        return NextResponse.json(
          { success: false, error: `Project resource '${id}' not found` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        uri,
        mimeType: "application/json",
        data: project,
      });
    }

    if (uri.startsWith("opm://cards/")) {
      const id = uri.replace("opm://cards/", "");
      const card = await db.card.findUnique({
        where: { id },
        include: {
          column: true,
          comments: true,
        },
      });
      if (!card) {
        return NextResponse.json(
          { success: false, error: `Card resource '${id}' not found` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        uri,
        mimeType: "application/json",
        data: card,
      });
    }

    return NextResponse.json(
      { success: false, error: `Resource non-existent: ${uri}` },
      { status: 404 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to read MCP resource" },
      { status: 500 }
    );
  }
}
