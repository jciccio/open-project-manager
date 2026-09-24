"use server";

import { getSession } from "@/lib/auth";
import { getTelemetryInfo, setTelemetryEnabled } from "@/lib/telemetry";

export async function getTelemetryStatus() {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }

  const info = await getTelemetryInfo();
  return { success: true as const, data: info };
}

export async function updateTelemetryPreference(enabled: boolean) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }

  setTelemetryEnabled(enabled);
  const info = await getTelemetryInfo();
  return { success: true as const, data: info };
}
