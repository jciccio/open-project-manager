import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import {
  GET,
  POST,
  PATCH,
  DELETE,
} from "../projects/[id]/members/route";

describe("API v1: /projects/[id]/members", () => {
  let ownerId: string;
  let ownerToken: string;
  let memberId: string;
  let memberEmail: string;
  let projectId: string;

  beforeEach(async () => {
    const u1 = await createTestUser(`api-owner-${Date.now()}`);
    const u2 = await createTestUser(`api-member-${Date.now()}`);

    ownerId = u1.user.id;
    ownerToken = u1.token;
    memberId = u2.user.id;
    memberEmail = u2.user.email;

    const proj = await createTestProject(ownerId, "API Membership Proj");
    projectId = proj.id;

    await db.projectMember.create({
      data: {
        projectId,
        userId: ownerId,
        role: "OWNER",
      },
    });
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(memberId);
  });

  it("lists project members", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/projects/${projectId}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    const res = await GET(req, { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].userId).toBe(ownerId);
  });

  it("adds and updates a member", async () => {
    // Add member
    const postReq = new NextRequest(`http://localhost:3000/api/v1/projects/${projectId}/members`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: memberEmail, role: "MEMBER" }),
    });

    const postRes = await POST(postReq, { params: Promise.resolve({ id: projectId }) });
    expect(postRes.status).toBe(201);
    const postJson = await postRes.json();
    expect(postJson.success).toBe(true);
    expect(postJson.data.userId).toBe(memberId);

    // Update member role
    const patchReq = new NextRequest(`http://localhost:3000/api/v1/projects/${projectId}/members`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: memberId, role: "ADMIN" }),
    });

    const patchRes = await PATCH(patchReq, { params: Promise.resolve({ id: projectId }) });
    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.success).toBe(true);
    expect(patchJson.data.role).toBe("ADMIN");

    // Remove member
    const delReq = new NextRequest(
      `http://localhost:3000/api/v1/projects/${projectId}/members?userId=${memberId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ownerToken}` },
      }
    );

    const delRes = await DELETE(delReq, { params: Promise.resolve({ id: projectId }) });
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.success).toBe(true);
  });
});
