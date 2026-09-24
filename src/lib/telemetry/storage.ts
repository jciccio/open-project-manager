import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface InstanceConfig {
  instanceId: string;
  createdAt: string;
  telemetryEnabled: boolean;
  updatedAt?: string;
}

let inMemoryConfig: InstanceConfig | null = null;

export function getDataDir(): string {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  if (process.env.UPLOADS_DIR) {
    return path.dirname(process.env.UPLOADS_DIR);
  }
  return path.join(process.cwd(), "data");
}

export function getInstanceStoragePath(): string {
  return path.join(getDataDir(), "instance.json");
}

export function getInstanceConfig(): InstanceConfig {
  if (process.env.OPM_INSTANCE_ID) {
    return {
      instanceId: process.env.OPM_INSTANCE_ID,
      createdAt: new Date().toISOString(),
      telemetryEnabled: true,
    };
  }

  const filePath = getInstanceStoragePath();

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed.instanceId) {
        return {
          instanceId: parsed.instanceId,
          createdAt: parsed.createdAt || new Date().toISOString(),
          telemetryEnabled: parsed.telemetryEnabled ?? true,
          updatedAt: parsed.updatedAt,
        };
      }
    }
  } catch (err) {
    // If reading fails, fall through to create or memory fallback
    if (process.env.DEBUG) {
      console.debug("[Telemetry] Failed to read instance config:", err);
    }
  }

  if (inMemoryConfig) {
    return inMemoryConfig;
  }

  const newConfig: InstanceConfig = {
    instanceId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    telemetryEnabled: true,
  };

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(newConfig, null, 2), "utf-8");
  } catch (err) {
    if (process.env.DEBUG) {
      console.debug("[Telemetry] Failed to write instance config to disk, using in-memory:", err);
    }
    inMemoryConfig = newConfig;
  }

  return newConfig;
}

export function setTelemetryEnabled(enabled: boolean): InstanceConfig {
  const current = getInstanceConfig();
  const updated: InstanceConfig = {
    ...current,
    telemetryEnabled: enabled,
    updatedAt: new Date().toISOString(),
  };

  const filePath = getInstanceStoragePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    if (process.env.DEBUG) {
      console.debug("[Telemetry] Failed to persist updated telemetry preference:", err);
    }
    inMemoryConfig = updated;
  }

  return updated;
}

export function isTelemetryEnabled(): boolean {
  if (
    process.env.OPM_TELEMETRY_DISABLED === "1" ||
    process.env.OPM_TELEMETRY_DISABLED === "true"
  ) {
    return false;
  }

  if (
    process.env.DO_NOT_TRACK === "1" ||
    process.env.DO_NOT_TRACK === "true"
  ) {
    return false;
  }

  if (process.env.NODE_ENV === "test" && !process.env.FORCE_TELEMETRY_TEST) {
    return false;
  }

  const config = getInstanceConfig();
  return config.telemetryEnabled !== false;
}

export function getTelemetryDisabledReason(): string | null {
  if (
    process.env.OPM_TELEMETRY_DISABLED === "1" ||
    process.env.OPM_TELEMETRY_DISABLED === "true"
  ) {
    return "Disabled via OPM_TELEMETRY_DISABLED environment variable";
  }

  if (
    process.env.DO_NOT_TRACK === "1" ||
    process.env.DO_NOT_TRACK === "true"
  ) {
    return "Disabled via DO_NOT_TRACK environment variable";
  }

  if (process.env.NODE_ENV === "test" && !process.env.FORCE_TELEMETRY_TEST) {
    return "Disabled in test environment";
  }

  const config = getInstanceConfig();
  if (config.telemetryEnabled === false) {
    return "Disabled by administrator setting in instance configuration";
  }

  return null;
}
