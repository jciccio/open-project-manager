import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST } from "../interactions/route";
import { proxy } from "@/proxy";

describe("POST /api/v1/integrations/discord/interactions", () => {
  const { publicKey: pubKeyObj, privateKey: privKeyObj } = crypto.generateKeyPairSync("ed25519");
  const rawPub = pubKeyObj.export({ type: "spki", format: "der" }).slice(-32);
  const publicKeyHex = rawPub.toString("hex");

  beforeEach(() => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
  });

  afterEach(() => {
    delete process.env.DISCORD_PUBLIC_KEY;
  });

  function makeSignedRequest(bodyObj: any, timestampOffset = 0) {
    const rawBody = JSON.stringify(bodyObj);
    const timestamp = String(Math.floor(Date.now() / 1000) + timestampOffset);
    const msg = Buffer.concat([Buffer.from(timestamp, "utf-8"), Buffer.from(rawBody, "utf-8")]);
    const sig = crypto.sign(null, msg, privKeyObj).toString("hex");

    return new NextRequest("http://localhost/api/v1/integrations/discord/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": sig,
        "X-Signature-Timestamp": timestamp,
      },
      body: rawBody,
    });
  }

  it("returns 503 when DISCORD_PUBLIC_KEY is not configured", async () => {
    delete process.env.DISCORD_PUBLIC_KEY;
    const req = new NextRequest("http://localhost/api/v1/integrations/discord/interactions", {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 401 when signature header is missing or invalid", async () => {
    const req = new NextRequest("http://localhost/api/v1/integrations/discord/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: 1 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 with { type: 1 } for valid Discord PING", async () => {
    const req = makeSignedRequest({ type: 1 });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe(1);
  });

  it("handles valid slash command interaction", async () => {
    const req = makeSignedRequest({
      id: "cmd-1",
      type: 2,
      data: {
        name: "opm",
        options: [{ name: "help", type: 1 }],
      },
      user: { id: "U_ANY", username: "tester" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe(4);
    expect(body.data?.content).toContain("/opm link");
  });

  it("allows unauthenticated interaction webhook through proxy", async () => {
    const req = new NextRequest("http://localhost/api/v1/integrations/discord/interactions", {
      method: "POST",
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(401);
  });
});
