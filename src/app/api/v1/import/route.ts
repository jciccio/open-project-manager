import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiSession } from "@/lib/auth";
import { runImport } from "@/lib/import/runImport";
import { VikunjaImporter } from "@/lib/import/vikunja";
import type { Importer } from "@/lib/import/types";

interface ImportSource {
  allowedEmail: () => string | undefined;
  build: (projectIds?: number[]) => Importer;
}

/**
 * Adapter registry. Each entry builds its importer from *server* configuration
 * only — the request never supplies a base URL or a source credential, so a
 * token holder cannot aim the server at an arbitrary host.
 */
const SOURCES: Record<string, ImportSource> = {
  vikunja: {
    allowedEmail: () => process.env.VIKUNJA_IMPORT_USER_EMAIL?.toLowerCase().trim() || undefined,
    build: (projectIds) => {
      const baseUrl = process.env.VIKUNJA_URL;
      const token = process.env.VIKUNJA_API_TOKEN;
      if (!baseUrl || !token) {
        throw new Error("Vikunja import is not configured: set VIKUNJA_URL and VIKUNJA_API_TOKEN on the server");
      }
      return new VikunjaImporter({ baseUrl, token, projectIds });
    },
  },
};

const importBodySchema = z.object({
  source: z.string().min(1),
  projectIds: z.array(z.number().int().positive()).min(1).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = importBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Invalid import request: `source` is required, `projectIds` must be a non-empty array of positive integers, and `dryRun` must be a boolean.",
      },
      { status: 400 }
    );
  }
  const body = parsed.data;

  if (!Object.hasOwn(SOURCES, body.source)) {
    return NextResponse.json(
      { error: `Unknown import source "${body.source}". Available: ${Object.keys(SOURCES).join(", ")}` },
      { status: 400 }
    );
  }
  const source = SOURCES[body.source];

  // The source credential is server-wide, so importing through the API is
  // limited to the one account it belongs to; the CLI remains the trusted path.
  const allowedEmail = source.allowedEmail();
  if (!allowedEmail || session.email.toLowerCase() !== allowedEmail) {
    return NextResponse.json(
      { error: `Importing from ${body.source} through the API is not enabled for this account.` },
      { status: 403 }
    );
  }

  let importer: Importer;
  try {
    importer = source.build(body.projectIds);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  try {
    const summary = await runImport(importer, session.userId, { dryRun: body.dryRun === true });
    if (summary.mode === "live") {
      for (const record of summary.records) {
        if (record.status === "failed") {
          console.error(`Import ${summary.importRunId} ${record.entityType} ${record.sourceId} failed:`, record.error);
          record.error = "Failed to import this record; see the server log.";
        }
      }
    }
    return NextResponse.json({ success: true, data: summary });
  } catch (err) {
    console.error("Import failed:", err);
    return NextResponse.json({ error: "Import failed; see the server log." }, { status: 500 });
  }
}
