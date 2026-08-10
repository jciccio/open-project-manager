import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { addCardRelation, removeCardRelation, getCardRelations } from "../relations";
import { createCard } from "../cards";
import { createProject, getProjectById } from "../projects";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";

describe("Card Relations Server Actions", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;
  let card1Id: string;
  let card2Id: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`relations-action-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });

    const pRes = await createProject({ name: "Relations Test Project" });
    projectId = pRes.data!.id;

    const projectDetails = await getProjectById(projectId);
    columnId = projectDetails.data!.columns[0].id;

    const c1 = await createCard({ projectId, columnId, title: "Card A" });
    const c2 = await createCard({ projectId, columnId, title: "Card B" });
    card1Id = c1.data!.id;
    card2Id = c2.data!.id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("creates BLOCKS relation between two cards", async () => {
    const res = await addCardRelation(card1Id, card2Id, "BLOCKS");
    expect(res.success).toBe(true);
    expect(res.data?.type).toBe("BLOCKS");

    const getRes1 = await getCardRelations(card1Id);
    expect(getRes1.success).toBe(true);
    expect(getRes1.data?.length).toBe(1);
    expect(getRes1.data?.[0].relationType).toBe("BLOCKS");

    const getRes2 = await getCardRelations(card2Id);
    expect(getRes2.success).toBe(true);
    expect(getRes2.data?.length).toBe(1);
    expect(getRes2.data?.[0].relationType).toBe("BLOCKED_BY");
  });

  it("prevents self-referencing relation", async () => {
    const res = await addCardRelation(card1Id, card1Id, "BLOCKS");
    expect(res.success).toBe(false);
    expect(res.error).toBe("A card cannot relate to itself");
  });

  it("deletes a card relation", async () => {
    const addRes = await addCardRelation(card1Id, card2Id, "RELATES_TO");
    const relationId = addRes.data!.id;

    const delRes = await removeCardRelation(relationId);
    expect(delRes.success).toBe(true);

    const getRes = await getCardRelations(card1Id);
    expect(getRes.data?.length).toBe(0);
  });
});
