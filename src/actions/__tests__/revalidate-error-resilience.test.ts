import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { revalidatePath } from "next/cache";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";
import { createCard } from "@/actions/cards";
import { uploadAttachment, deleteAttachment, listAttachments } from "@/actions/attachments";

describe("safeRevalidatePath resilience", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`revalidate-resilience-${Date.now()}`);
    userId = userRes.user.id;

    const project = await createTestProject(userId, "Revalidate Resilience Project");
    projectId = project.id;

    const column = await createTestColumn(projectId, "To Do", 0);
    columnId = column.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("uploadAttachment still succeeds when revalidatePath throws outside a request context", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in revalidatePath");
    });

    const cardRes = await createCard({ projectId, columnId, title: "Attachment host card" }, userId);
    const cardId = cardRes.data!.id;

    const uploadRes = await uploadAttachment(
      {
        cardId,
        filename: "resilience-test.txt",
        contentBuffer: Buffer.from("content"),
        mimeType: "text/plain",
      },
      userId
    );

    expect(uploadRes.success).toBe(true);

    const listRes = await listAttachments(cardId, userId);
    expect(listRes.data?.length).toBe(1);

    // Clean up the file written to disk (deleteAttachment unlinks it).
    await deleteAttachment(uploadRes.data!.id, userId);
  });

  it("createCard still succeeds when revalidatePath throws outside a request context", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in revalidatePath");
    });

    const res = await createCard({ projectId, columnId, title: "Should still be created" }, userId);

    expect(res.success).toBe(true);
    expect(res.data?.title).toBe("Should still be created");
  });
});
