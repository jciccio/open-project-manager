import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { nextCardNumber, withCardNumberRetry } from "../cardNumbering";
import { createTestUser, cleanupTestUser, createTestProject, createTestColumn } from "@/test/helpers";

describe("cardNumbering", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) await cleanupTestUser(userId);
  });

  it("recovers from a stale starting number by re-reading the max and retrying", async () => {
    const { user } = await createTestUser(`cardnum-${Date.now()}`);
    userId = user.id;
    const project = await createTestProject(userId, "Card Numbering Test");
    const column = await createTestColumn(project.id);

    await db.card.create({
      data: { projectId: project.id, columnId: column.id, title: "Existing", number: 1 },
    });

    // firstAttemptNumber=1 simulates a caller whose read of the max is
    // already stale by the time it tries to insert.
    const created = await withCardNumberRetry(project.id, 1, (number) =>
      db.card.create({
        data: { projectId: project.id, columnId: column.id, title: "Recovered", number },
      })
    );

    expect(created.number).toBe(2);
    expect(await nextCardNumber(project.id)).toBe(3);
  });

  it("gives up after repeated collisions and surfaces the underlying error", async () => {
    const { user } = await createTestUser(`cardnum-exhaust-${Date.now()}`);
    userId = user.id;
    const project = await createTestProject(userId, "Card Numbering Exhaustion Test");
    const column = await createTestColumn(project.id);

    await db.card.create({
      data: { projectId: project.id, columnId: column.id, title: "Existing", number: 1 },
    });

    await expect(
      withCardNumberRetry(project.id, 1, () =>
        db.card.create({
          data: { projectId: project.id, columnId: column.id, title: "Always collides", number: 1 },
        })
      )
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
