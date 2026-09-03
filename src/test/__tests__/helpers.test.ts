import { describe, it, expect, afterEach } from "vitest";
import {
  createTestUser,
  createTestProject,
  createTestColumn,
  createTestCard,
  cleanupTestUser,
} from "../helpers";

describe("test helpers", () => {
  let createdUserId: string | null = null;

  afterEach(async () => {
    if (createdUserId) {
      await cleanupTestUser(createdUserId);
      createdUserId = null;
    }
  });

  it("createTestCard assigns sequential numbers for repeated calls against the same project", async () => {
    const { user } = await createTestUser(`helpers-test-${Date.now()}`);
    createdUserId = user.id;

    const project = await createTestProject(user.id);
    const column = await createTestColumn(project.id);

    const card1 = await createTestCard(project.id, column.id, "First");
    const card2 = await createTestCard(project.id, column.id, "Second");
    const card3 = await createTestCard(project.id, column.id, "Third");

    expect(card1.number).toBe(1);
    expect(card2.number).toBe(2);
    expect(card3.number).toBe(3);
  });
});
