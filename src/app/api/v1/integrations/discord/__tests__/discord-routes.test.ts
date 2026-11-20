import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST } from "../interactions/route";
import { POST as linkCodePOST } from "../link-code/route";
import { GET as linksGET, DELETE as linksDELETE } from "../links/route";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";
import { signApiToken, signToken } from "@/lib/auth";
import { handleDiscordInteraction } from "@/lib/integrations/discord";
import { proxy } from "@/proxy";

describe("POST /api/v1/integrations/discord/interactions", () => {
  const { publicKey: pubKeyObj, privateKey: privKeyObj } = crypto.generateKeyPairSync("ed25519");
  const rawPub = pubKeyObj.export({ type: "spki", format: "der" }).slice(-32);
  const publicKeyHex = rawPub.toString("hex");
  const createdUserIds: string[] = [];

  beforeEach(() => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.DISCORD_PUBLIC_KEY;
    while (createdUserIds.length > 0) {
      const uid = createdUserIds.pop()!;
      await cleanupTestUser(uid);
    }
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

  it("defers type-2 interactions with application_id + token using type 5 and patches @original followup", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));

    const req = makeSignedRequest({
      id: "cmd-deferred",
      type: 2,
      application_id: "123456789012345678",
      token: "interaction_secret_token.abc-123",
      data: {
        name: "opm",
        options: [{ name: "help", type: 1 }],
      },
      user: { id: "U_ANY", username: "tester" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ type: 5, data: { flags: 64 } });

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(
      "https://discord.com/api/v10/webhooks/123456789012345678/interaction_secret_token.abc-123/messages/@original"
    );
    expect(init?.method).toBe("PATCH");
    const followupBody = JSON.parse(String(init?.body));
    expect(followupBody.content).toContain("/opm link");
  });

  it("rejects malformed application_id or interaction token with 400", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const req = makeSignedRequest({
      id: "cmd-bad-token",
      type: 2,
      application_id: "123456789",
      token: "../evil/path",
      data: {
        name: "opm",
        options: [{ name: "help", type: 1 }],
      },
      user: { id: "U_ANY", username: "tester" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues short-lived link codes from POST /api/v1/integrations/discord/link-code for cookie sessions and rejects Bearer tokens", async () => {
    const unauthReq = new NextRequest("http://localhost/api/v1/integrations/discord/link-code", {
      method: "POST",
    });
    const unauthRes = await linkCodePOST(unauthReq);
    expect(unauthRes.status).toBe(401);

    const { user } = await createTestUser(`disc-linkcode-${Date.now()}`);
    createdUserIds.push(user.id);
    const apiRow = await db.apiToken.create({ data: { userId: user.id, name: "Code Test" } });
    const secret = await signApiToken(
      { userId: user.id, email: user.email, name: user.name, tokenVersion: user.tokenVersion },
      apiRow.id
    );

    // Bearer token must be rejected with 403 to prevent leaked API tokens from minting link codes
    const bearerReq = new NextRequest("http://localhost/api/v1/integrations/discord/link-code", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    const bearerRes = await linkCodePOST(bearerReq);
    expect(bearerRes.status).toBe(403);
    const bearerData = await bearerRes.json();
    expect(bearerData.error).toContain("Forbidden");

    // Cookie session succeeds
    const sessionToken = await signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      tokenVersion: user.tokenVersion,
    });
    const authReq = new NextRequest("http://localhost/api/v1/integrations/discord/link-code", {
      method: "POST",
      headers: { Cookie: `opm_session=${sessionToken}` },
    });
    const authRes = await linkCodePOST(authReq);
    expect(authRes.status).toBe(201);
    const payload = await authRes.json();
    expect(payload.code).toMatch(/^opm_dl_/);
    expect(typeof payload.expiresAt).toBe("string");

    const linked = await handleDiscordInteraction({
      id: "i-route-linkcode",
      type: 2,
      data: {
        name: "opm",
        options: [{ name: "link", type: 1, options: [{ name: "token", type: 3, value: payload.code }] }],
      },
      user: { id: "DISCORD_ROUTE_CODE_USER", username: "routecoder" },
    });
    expect(linked.data?.content).toContain("Successfully linked");

    // API-token JWT sent as Cookie: opm_session=... must be rejected with 401
    const apiJwtCookieReq = new NextRequest("http://localhost/api/v1/integrations/discord/link-code", {
      method: "POST",
      headers: { Cookie: `opm_session=${secret}` },
    });
    expect((await linkCodePOST(apiJwtCookieReq)).status).toBe(401);

    // Stale tokenVersion cookie must be rejected with 401
    const staleSessionToken = await signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      tokenVersion: user.tokenVersion + 1,
    });
    const staleCookieReq = new NextRequest("http://localhost/api/v1/integrations/discord/link-code", {
      method: "POST",
      headers: { Cookie: `opm_session=${staleSessionToken}` },
    });
    expect((await linkCodePOST(staleCookieReq)).status).toBe(401);

    // GET /api/v1/integrations/discord/links lists linked account for cookie session and rejects Bearer
    const bearerListReq = new NextRequest("http://localhost/api/v1/integrations/discord/links", {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect((await linksGET(bearerListReq)).status).toBe(403);

    const listReq = new NextRequest("http://localhost/api/v1/integrations/discord/links", {
      method: "GET",
      headers: { Cookie: `opm_session=${sessionToken}` },
    });
    const listRes = await linksGET(listReq);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.links).toHaveLength(1);
    expect(listBody.links[0].discordUserId).toBe("DISCORD_ROUTE_CODE_USER");

    // DELETE /api/v1/integrations/discord/links?id=... revokes the link
    const delReq = new NextRequest(
      `http://localhost/api/v1/integrations/discord/links?id=${encodeURIComponent(listBody.links[0].id)}`,
      {
        method: "DELETE",
        headers: { Cookie: `opm_session=${sessionToken}` },
      }
    );
    const delRes = await linksDELETE(delReq);
    expect(delRes.status).toBe(200);

    const whoAfter = await handleDiscordInteraction({
      id: "i-route-whoami-after-revoke",
      type: 2,
      data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
      user: { id: "DISCORD_ROUTE_CODE_USER", username: "routecoder" },
    });
    expect(whoAfter.data?.content).toContain("not linked");
  });

  it("allows unauthenticated interaction webhook through proxy", async () => {
    const req = new NextRequest("http://localhost/api/v1/integrations/discord/interactions", {
      method: "POST",
    });

    const res = await proxy(req);
    expect(res.status).not.toBe(401);
  });
});
