import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getLabelsRoute } from "../labels/route";
import { getLabels } from "@/actions/labels";
import { createSession, destroySession } from "@/lib/auth";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import { db } from "@/lib/db";

async function listLabelNames(token: string): Promise<string[]> {
  const res = await getLabelsRoute(
    new NextRequest("http://localhost/api/v1/labels", { headers: { authorization: `Bearer ${token}` } })
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data.map((l: { name: string }) => l.name);
}

describe("Unscoped label listing", () => {
  const suffix = Date.now();
  let owner: { id: string; email: string; name: string; token: string };
  let other: { id: string; email: string; name: string; token: string };
  let globalLabelId: string;

  const projectLabel = `Private Project Label ${suffix}`;
  const personalLabel = `Owner Personal Label ${suffix}`;
  const globalLabel = `Global Label ${suffix}`;

  beforeEach(async () => {
    const a = await createTestUser(`labels-scope-owner-${suffix}`);
    const b = await createTestUser(`labels-scope-other-${suffix}`);
    owner = { ...a.user, token: a.token };
    other = { ...b.user, token: b.token };

    const project = await createTestProject(owner.id, "Labels Scope Private");
    await db.label.create({ data: { name: projectLabel, projectId: project.id } });
    await db.label.create({ data: { name: personalLabel, userId: owner.id } });
    globalLabelId = (await db.label.create({ data: { name: globalLabel } })).id;
  });

  afterEach(async () => {
    await destroySession();
    await db.label.delete({ where: { id: globalLabelId } });
    await cleanupTestUser(owner.id);
    await cleanupTestUser(other.id);
  });

  it("doesn't return another user's private project labels over REST", async () => {
    const names = await listLabelNames(other.token);

    expect(names).not.toContain(projectLabel);
    expect(names).not.toContain(personalLabel);
    expect(names).toContain(globalLabel);
  });

  it("doesn't return another user's private project labels through the server action", async () => {
    await createSession({ userId: other.id, email: other.email, name: other.name });

    const res = await getLabels();
    const names = res.data!.map((l) => l.name);

    expect(names).not.toContain(projectLabel);
    expect(names).toContain(globalLabel);
  });

  it("still returns the owner's personal, global and project labels", async () => {
    const names = await listLabelNames(owner.token);

    expect(names).toEqual(expect.arrayContaining([projectLabel, personalLabel, globalLabel]));
  });

  it("returns a project's labels to a member of that project", async () => {
    const project = await db.project.findFirstOrThrow({ where: { userId: owner.id } });
    await db.projectMember.create({ data: { projectId: project.id, userId: other.id, role: "VIEWER" } });

    const names = await listLabelNames(other.token);

    expect(names).toContain(projectLabel);
    expect(names).not.toContain(personalLabel);
  });

  it("returns an internal project's labels to any account", async () => {
    await db.project.updateMany({ where: { userId: owner.id }, data: { visibility: "INTERNAL" } });

    const names = await listLabelNames(other.token);

    expect(names).toContain(projectLabel);
  });
});
