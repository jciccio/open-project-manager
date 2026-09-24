import { isTelemetryEnabled, getTelemetryDisabledReason, getInstanceConfig } from "./storage";
import { buildTelemetryPayload } from "./payload";

export * from "./storage";
export * from "./payload";

export const DEFAULT_TELEMETRY_URL = "https://telemetry.openprojectmanager.org/api/v1/heartbeat";
export const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const INITIAL_DELAY_MS = 15 * 1000; // 15 seconds

let isInitialized = false;
let heartbeatTimer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;

export function getTelemetryEndpoint(): string {
  return process.env.OPM_TELEMETRY_URL || DEFAULT_TELEMETRY_URL;
}

export async function sendHeartbeat(): Promise<{ sent: boolean; reason?: string }> {
  if (!isTelemetryEnabled()) {
    const reason = getTelemetryDisabledReason() || "Telemetry disabled";
    return { sent: false, reason };
  }

  const endpoint = getTelemetryEndpoint();

  try {
    const payload = await buildTelemetryPayload();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `OpenProjectManager/${payload.appVersion} (${payload.platform})`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      if (process.env.DEBUG) {
        console.debug("[Telemetry] Heartbeat sent successfully to", endpoint);
      }
      return { sent: true };
    } else {
      if (process.env.DEBUG) {
        console.debug("[Telemetry] Heartbeat endpoint returned status", response.status);
      }
      return { sent: false, reason: `HTTP status ${response.status}` };
    }
  } catch (err: unknown) {
    if (process.env.DEBUG) {
      console.debug("[Telemetry] Failed to dispatch heartbeat:", err);
    }
    const message = err instanceof Error ? err.message : String(err);
    return { sent: false, reason: message };
  }
}

export function initTelemetry(): void {
  if (isInitialized) return;
  isInitialized = true;

  if (!isTelemetryEnabled()) {
    if (process.env.DEBUG) {
      console.debug("[Telemetry] Skipped initialization:", getTelemetryDisabledReason());
    }
    return;
  }

  // Delay first heartbeat so server startup and migrations settle
  initialTimer = setTimeout(async () => {
    await sendHeartbeat();
  }, INITIAL_DELAY_MS);
  initialTimer.unref();

  // Periodic daily heartbeat
  heartbeatTimer = setInterval(async () => {
    await sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

export async function getTelemetryInfo() {
  const config = getInstanceConfig();
  const enabled = isTelemetryEnabled();
  const disabledReason = getTelemetryDisabledReason();
  const endpoint = getTelemetryEndpoint();
  const samplePayload = await buildTelemetryPayload();

  return {
    enabled,
    disabledReason,
    instanceId: config.instanceId,
    createdAt: config.createdAt,
    endpoint,
    payload: samplePayload,
  };
}
