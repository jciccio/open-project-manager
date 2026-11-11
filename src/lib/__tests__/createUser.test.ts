import { describe, it, expect, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { createPasswordUser } from "@/lib/createUser";
import { addProjectMember } from "@/lib/services/members";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";

describe("createPasswordUser", () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const id of created.splice(0)) await cleanupTestUser(id);
  });

  it("creates an account with a lowercased email and a hashed password", async () => {
    const email = `New.Person-${Date.now()}@Example.invalid`;

    const res = await createPasswordUser({ name: "  New Person ", email: `  ${email} `, password: "temp-secret-123" });

    expect(res.success).toBe(true);
    if (!res.success) return;
    created.push(res.user.id);
    expect(res.user.email).toBe(email.toLowerCase());
    expect(res.user.name).toBe("New Person");
    expect(res.user.passwordHash).not.toBe("temp-secret-123");
    expect(await bcrypt.compare("temp-secret-123", res.user.passwordHash!)).toBe(true);
  });

  it("refuses a duplicate email regardless of case", async () => {
    const email = `dup-${Date.now()}@example.invalid`;
    const first = await createPasswordUser({ name: "First", email, password: "secret-123" });
    if (first.success) created.push(first.user.id);

    const second = await createPasswordUser({ name: "Second", email: email.toUpperCase(), password: "secret-456" });

    expect(second).toEqual({ success: false, error: "An account with this email already exists." });
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("refuses a short password and missing fields without creating anything", async () => {
    const email = `short-${Date.now()}@example.invalid`;

    expect(await createPasswordUser({ name: "Short", email, password: "12345" })).toEqual({
      success: false,
      error: "Password must be at least 6 characters long.",
    });
    expect(await createPasswordUser({ name: " ", email, password: "secret-123" })).toEqual({
      success: false,
      error: "All fields are required.",
    });
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it("creates someone a project owner can then add from the members modal", async () => {
    const owner = await createTestUser(`create-user-owner-${Date.now()}`);
    created.push(owner.user.id);
    const project = await createTestProject(owner.user.id, "Invite Target");
    const email = `invitee-${Date.now()}@example.invalid`;
    const res = await createPasswordUser({ name: "Invitee", email, password: "secret-123" });
    if (res.success) created.push(res.user.id);

    const added = await addProjectMember(project.id, email, "MEMBER", owner.user.id);

    expect(added.success).toBe(true);
  });
});
