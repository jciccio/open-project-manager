import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  getInstanceConfig,
  setTelemetryEnabled,
  isTelemetryEnabled,
  getTelemetryDisabledReason,
  getInstanceStoragePath,
} from "../storage";
import { buildTelemetryPayload } from "../payload";
import { sendHeartbeat, DEFAULT_TELEMETRY_URL } from "../index";

describe("Telemetry Module", () => {
  const originalEnv = { ...process.env };
  const testDataDir = path.join(process.cwd(), "data", "test-telemetry");

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATA_DIR = testDataDir;
    delete process.env.OPM_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    delete process.env.OPM_INSTANCE_ID;
    process.env.FORCE_TELEMETRY_TEST = "true";

    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("Storage and Instance Identification", () => {
    it("generates and persists a valid UUID instance ID", () => {
      const config1 = getInstanceConfig();
      expect(config1.instanceId).toBeDefined();
      expect(config1.instanceId.length).toBeGreaterThan(10);
      expect(config1.telemetryEnabled).toBe(true);

      const filePath = getInstanceStoragePath();
      expect(fs.existsSync(filePath)).toBe(true);

      // Subsequent calls return the same instance ID
      const config2 = getInstanceConfig();
      expect(config2.instanceId).toBe(config1.instanceId);
    });

    it("respects explicit OPM_INSTANCE_ID from environment", () => {
      process.env.OPM_INSTANCE_ID = "custom-instance-uuid-12345";
      const config = getInstanceConfig();
      expect(config.instanceId).toBe("custom-instance-uuid-12345");
    });

    it("allows updating telemetry preference and persists change", () => {
      getInstanceConfig();
      const updated = setTelemetryEnabled(false);
      expect(updated.telemetryEnabled).toBe(false);

      const reloaded = getInstanceConfig();
      expect(reloaded.telemetryEnabled).toBe(false);

      setTelemetryEnabled(true);
      expect(getInstanceConfig().telemetryEnabled).toBe(true);
    });
  });

  describe("Opt-Out and Telemetry Status", () => {
    it("reports enabled when no disable flag is present", () => {
      expect(isTelemetryEnabled()).toBe(true);
      expect(getTelemetryDisabledReason()).toBeNull();
    });

    it("respects OPM_TELEMETRY_DISABLED=1", () => {
      process.env.OPM_TELEMETRY_DISABLED = "1";
      expect(isTelemetryEnabled()).toBe(false);
      expect(getTelemetryDisabledReason()).toContain("OPM_TELEMETRY_DISABLED");
    });

    it("respects DO_NOT_TRACK=1", () => {
      process.env.DO_NOT_TRACK = "1";
      expect(isTelemetryEnabled()).toBe(false);
      expect(getTelemetryDisabledReason()).toContain("DO_NOT_TRACK");
    });

    it("respects stored telemetryEnabled: false preference", () => {
      setTelemetryEnabled(false);
      expect(isTelemetryEnabled()).toBe(false);
      expect(getTelemetryDisabledReason()).toContain("administrator setting");
    });
  });

  describe("Payload Builder", () => {
    it("constructs non-PII diagnostic payload with system metrics", async () => {
      const payload = await buildTelemetryPayload();

      expect(payload).toHaveProperty("instanceId");
      expect(payload).toHaveProperty("appVersion");
      expect(payload).toHaveProperty("platform");
      expect(payload).toHaveProperty("nodeVersion");
      expect(payload).toHaveProperty("dbProvider");
      expect(["sqlite", "postgresql"]).toContain(payload.dbProvider);
      expect(payload).toHaveProperty("isDocker");
      expect(typeof payload.uptimeSeconds).toBe("number");
      expect(payload).toHaveProperty("timestamp");

      // Verify metrics object contains counts
      expect(payload.metrics).toHaveProperty("usersCount");
      expect(payload.metrics).toHaveProperty("projectsCount");
      expect(payload.metrics).toHaveProperty("cardsCount");
      expect(typeof payload.metrics.usersCount).toBe("number");

      // Verify features
      expect(payload.features).toHaveProperty("oidcEnabled");
      expect(payload.features).toHaveProperty("mcpEnabled");
      expect(payload.features.mcpEnabled).toBe(true);
    });
  });

  describe("Heartbeat Dispatcher", () => {
    it("skips dispatch when telemetry is disabled", async () => {
      process.env.OPM_TELEMETRY_DISABLED = "1";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await sendHeartbeat();
      expect(result.sent).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("dispatches payload to telemetry endpoint when enabled", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      const result = await sendHeartbeat();
      expect(result.sent).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(DEFAULT_TELEMETRY_URL);
      expect(options?.method).toBe("POST");

      const body = JSON.parse(options?.body as string);
      expect(body).toHaveProperty("instanceId");
      expect(body).toHaveProperty("metrics");
    });

    it("handles network failure gracefully without throwing errors", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout"));

      const result = await sendHeartbeat();
      expect(result.sent).toBe(false);
      expect(result.reason).toContain("Network timeout");
    });
  });
});
