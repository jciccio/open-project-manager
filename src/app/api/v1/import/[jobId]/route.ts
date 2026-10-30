import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { getImportJob } from "@/lib/import/jobs";

interface Props {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await getImportJob(jobId, session.userId);
  if (!job) {
    return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: job });
}
