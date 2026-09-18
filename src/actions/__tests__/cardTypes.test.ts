import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCardType, getCardTypes, updateCardType, deleteCardType } from "../cardTypes";
import { createProject, getProjectById } from "../projects";
import { createCard, updateCard } from "../cards";
import { updateCardType as updateCardTypeService } from "@/lib/services/cardTypes";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";

describe("Card Type Server Actions", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`card-types-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });

    const pRes = await createProject({ name: "Card Types Project" });
    projectId = pRes.data!.id;

    const projectDetails = await getProjectById(projectId);
    columnId = projectDetails.data!.columns[0].id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("seeds default card types on project creation", async () => {
    const projectDetails = await getProjectById(projectId);
    expect(projectDetails.success).toBe(true);
    const cardTypes = (projectDetails.data as any).cardTypes;
    expect(cardTypes.length).toBeGreaterThan(0);
    expect(cardTypes.some((ct: any) => ct.name === "Bug")).toBe(true);
  });

  it("creates, fetches, updates, and deletes a project-scoped card type", async () => {
    const createRes = await createCardType("Chore", projectId, "Wrench", "#f97316");
    expect(createRes.success).toBe(true);
    expect(createRes.data?.name).toBe("Chore");
    expect(createRes.data?.projectId).toBe(projectId);

    const getRes = await getCardTypes(projectId);
    expect(getRes.success).toBe(true);
    expect(getRes.data?.some((ct) => ct.name === "Chore")).toBe(true);

    const updateRes = await updateCardType(createRes.data!.id, { name: "Maintenance", color: "#06b6d4" });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.name).toBe("Maintenance");
    expect(updateRes.data?.color).toBe("#06b6d4");

    const delRes = await deleteCardType(createRes.data!.id);
    expect(delRes.success).toBe(true);

    const afterDelete = await getCardTypes(projectId);
    expect(afterDelete.data?.some((ct) => ct.id === createRes.data!.id)).toBe(false);
  });

  it("rejects access to another user's card type", async () => {
    const { user: otherUser } = await createTestUser(`card-types-other-${Date.now()}`);
    try {
      const createRes = await createCardType("Epic", projectId, "Layers", "#8b5cf6");
      const res = await updateCardTypeService(createRes.data!.id, { name: "Hacked" }, otherUser.id);
      expect(res.success).toBe(false);
    } finally {
      await cleanupTestUser(otherUser.id);
    }
  });

  it("assigns and clears a card's type via createCard and updateCard", async () => {
    const typeRes = await createCardType("Spike", projectId, "Sparkles", "#10b981");
    const typeId = typeRes.data!.id;

    const cardRes = await createCard({ projectId, columnId, title: "Typed Card", typeId });
    expect(cardRes.success).toBe(true);
    expect((cardRes.data as any).type?.id).toBe(typeId);

    const clearRes = await updateCard(cardRes.data!.id, { typeId: "" });
    expect(clearRes.success).toBe(true);
    expect((clearRes.data as any).type).toBe(null);
  });
});
