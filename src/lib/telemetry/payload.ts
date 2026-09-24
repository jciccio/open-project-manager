import fs from "fs";
import { db, getDatabaseProvider } from "@/lib/db";
import { getInstanceConfig } from "./storage";

export interface TelemetryPayload {
  instanceId: string;
  appVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  dbProvider: "sqlite" | "postgresql";
  isDocker: boolean;
  uptimeSeconds: number;
  timestamp: string;
  metrics: {
    usersCount: number;
    projectsCount: number;
    cardsCount: number;
  };
  features: {
    oidcEnabled: boolean;
    mcpEnabled: boolean;
    customPort: boolean;
  };
}

export function detectIsDocker(): boolean {
  if (process.env.DOCKER_CONTAINER === "true" || process.env.IS_DOCKER === "true") {
    return true;
  }
  try {
    if (fs.existsSync("/.dockerenv")) {
      return true;
    }
  } catch {
    // Ignore filesystem permission errors
  }
  return false;
}

export async function buildTelemetryPayload(): Promise<TelemetryPayload> {
  const config = getInstanceConfig();
  const dbProvider = getDatabaseProvider();

  let usersCount = 0;
  let projectsCount = 0;
  let cardsCount = 0;

  try {
    const [u, p, c] = await Promise.all([
      db.user.count(),
      db.project.count(),
      db.card.count(),
    ]);
    usersCount = u;
    projectsCount = p;
    cardsCount = c;
  } catch (err) {
    if (process.env.DEBUG) {
      console.debug("[Telemetry] Failed to query database metrics for telemetry payload:", err);
    }
  }

  // Version: default to 0.4.0 (fallback if package.json not directly accessible)
  const appVersion = process.env.npm_package_version || "0.4.0";

  return {
    instanceId: config.instanceId,
    appVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    dbProvider,
    isDocker: detectIsDocker(),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    metrics: {
      usersCount,
      projectsCount,
      cardsCount,
    },
    features: {
      oidcEnabled: Boolean(process.env.OIDC_ISSUER_URL),
      mcpEnabled: true,
      customPort: Boolean(process.env.PORT && process.env.PORT !== "3000"),
    },
  };
}
