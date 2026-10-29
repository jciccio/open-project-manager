import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { addComment, listComments } from "../comments";
import { uploadAttachment, listAttachments } from "../attachments";
import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

describe("Comment and attachment attribution", () => {
  let userId: string;
  let userName: string;
  let projectId: string;
  let cardId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`attribution-${Date.now()}`);
    userId = user.id;
    userName = user.name;
    await createSession({ userId, email: user.email, name: user.name });

    const project = await db.project.create({
      data: {
        name: "Attribution Test Project",
        userId,
        columns: {
          create: { name: "To Do", order: 0 },
        },
      },
      include: { columns: true },
    });
    projectId = project.id;

    const card = await db.card.create({
      data: {
        projectId,
        columnId: project.columns[0].id,
        title: "Test Card",
        number: 1,
      },
    });
    cardId = card.id;
  });

  afterEach(async () => {
    await destroySession();
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
    if (userId) {
      await cleanupTestUser(userId);
    }
  });

  it("records authorUserId and author name from session when adding a comment", async () => {
    const res = await addComment(cardId, "Great progress on this!");
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const comment = res.data!;
    expect(comment.content).toBe("Great progress on this!");
    expect(comment.author).toBe(userName);
    expect(comment.authorUserId).toBe(userId);
    expect(comment.authorUser?.name).toBe(userName);

    // Verify DB persistence
    const inDb = await db.comment.findUnique({
      where: { id: comment.id },
      include: { authorUser: true },
    });
    expect(inDb?.authorUserId).toBe(userId);
    expect(inDb?.authorUser?.name).toBe(userName);
  });

  it("prevents spoofing comment author when authenticated session is active", async () => {
    // Even if client attempts to pass a spoofed author name
    const res = await addComment(cardId, "Spoofed Author", "Malicious message");
    expect(res.success).toBe(true);
    expect(res.data?.author).toBe(userName);
    expect(res.data?.authorUserId).toBe(userId);
  });

  it("listComments returns authorUser relation", async () => {
    await addComment(cardId, "A comment with user link");
    const listRes = await listComments(cardId);
    expect(listRes.success).toBe(true);
    expect(listRes.data?.length).toBeGreaterThan(0);
    expect(listRes.data![0].authorUser?.id).toBe(userId);
    expect(listRes.data![0].authorUser?.name).toBe(userName);
  });

  it("uploadAttachment attributes uploadedBy to authenticated session user", async () => {
    const res = await uploadAttachment({
      cardId,
      filename: "test-report.pdf",
      contentBuffer: Buffer.from("dummy pdf content"),
      mimeType: "application/pdf",
      uploadedBy: "Spoofed User",
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data?.uploadedBy).toBe(userName);

    const listRes = await listAttachments(cardId);
    expect(listRes.success).toBe(true);
    expect(listRes.data?.find((a) => a.id === res.data!.id)?.uploadedBy).toBe(userName);
  });
});
