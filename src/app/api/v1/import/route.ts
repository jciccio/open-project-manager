import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { runImport } from "@/lib/import/runImport";
import { VikunjaImporter } from "@/lib/import/vikunja";
import type { Importer } from "@/lib/import/types";

/**
 * Adapter registry. Each entry builds its importer from *server* configuration
 * only — the request never supplies a base URL or a source credential, so a
 * token holder cannot aim the server at an arbitrary host.
 */
const SOURCES: Record<string, (projectIds?: number[]) => Importer> = {
  vikunja: (projectIds) => {
    const baseUrl = process.env.VIKUNJA_URL;
    const token = process.env.VIKUNJA_API_TOKEN;
    if (!baseUrl || !token) {
      throw new Error("Vikunja import is not configured: set VIKUNJA_URL and VIKUNJA_API_TOKEN on the server");
    }
    return new VikunjaImporter({ baseUrl, token, projectIds });
  },
};

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    source?: string;
    projectIds?: unknown;
    dryRun?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const source = body.source;
  if (!source || !(source in SOURCES)) {
    return NextResponse.json(
      { error: `Unknown import source "${source ?? ""}". Available: ${Object.keys(SOURCES).join(", ")}` },
      { status: 400 }
    );
  }

  let projectIds: number[] | undefined;
  if (body.projectIds !== undefined) {
    if (!Array.isArray(body.projectIds) || body.projectIds.some((id) => typeof id !== "number")) {
      return NextResponse.json({ error: "projectIds must be an array of numbers" }, { status: 400 });
    }
    projectIds = body.projectIds as number[];
  }

  let importer: Importer;
  try {
    importer = SOURCES[source](projectIds);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  try {
    const summary = await runImport(importer, session.userId, { dryRun: body.dryRun === true });
    return NextResponse.json({ success: true, data: summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
