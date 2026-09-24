import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { getTelemetryInfo, setTelemetryEnabled } from "@/lib/telemetry";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const info = await getTelemetryInfo();
  return NextResponse.json({ success: true, data: info });
}

export async function PATCH(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "Invalid payload: 'enabled' boolean is required." },
        { status: 400 }
      );
    }

    setTelemetryEnabled(body.enabled);
    const info = await getTelemetryInfo();
    return NextResponse.json({ success: true, data: info });
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
