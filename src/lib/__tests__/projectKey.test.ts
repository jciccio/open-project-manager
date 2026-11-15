import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { generateProjectKey } from "../projectKey";

describe("generateProjectKey", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`project-key-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  async function take(key: string) {
    await db.project.create({ data: { userId, name: `Holds ${key}`, key } });
  }

  describe("keys derived from the name", () => {
    it("uses initials and numbers the next ones", async () => {
      expect(await generateProjectKey("Alpha Beta", undefined, userId)).toBe("AB");
      await take("AB");
      expect(await generateProjectKey("Amazing Bicycle", undefined, userId)).toBe("AB2");
      await take("AB2");
      expect(await generateProjectKey("Another Boat", undefined, userId)).toBe("AB3");
    });

    it("keeps at most six initials, and a suffix stays within six", async () => {
      const name = "One Two Three Four Five Six Seven";
      expect(await generateProjectKey(name, undefined, userId)).toBe("OTTFFS");
      await take("OTTFFS");
      expect(await generateProjectKey(name, undefined, userId)).toBe("OTTFF2");
    });

    it("uses the first four letters of a single word", async () => {
      expect(await generateProjectKey("Roadmap", undefined, userId)).toBe("ROAD");
    });

    it("falls back to the name when the requested key has no usable characters", async () => {
      expect(await generateProjectKey("Alpha Beta", "!!!", userId)).toBe("AB");
    });
  });

  describe("requested keys", () => {
    it("uppercases and strips everything but letters and digits", async () => {
      expect(await generateProjectKey("Anything", " la-b_2 ", userId)).toBe("LAB2");
    });

    it("numbers a short key that is taken", async () => {
      await take("LAB");
      expect(await generateProjectKey("Anything", "lab", userId)).toBe("LAB2");
    });

    it("keeps a key of twelve characters", async () => {
      expect(await generateProjectKey("Anything", "ABCDEFGHIJKL", userId)).toBe("ABCDEFGHIJKL");
    });

    it("cuts a longer key to twelve characters", async () => {
      expect(await generateProjectKey("Anything", "ABCDEFGHIJKLM", userId)).toBe("ABCDEFGHIJKL");
    });

    it("keeps a numbered twelve-character key within twelve characters", async () => {
      await take("ABCDEFGHIJKL");
      expect(await generateProjectKey("Anything", "ABCDEFGHIJKL", userId)).toBe("ABCDEFGHIJK2");
    });

    it("keeps all six letters of a taken six-character key", async () => {
      await take("ABCDEF");
      expect(await generateProjectKey("Anything", "ABCDEF", userId)).toBe("ABCDEF2");
    });
  });
});
