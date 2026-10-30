import { describe, it, expect } from "vitest";
import { en } from "../en";
import { es } from "../es";

function extractLeafKeys(obj: any, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...extractLeafKeys(value, fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

describe("i18n dictionary parity", () => {
  const enKeys = extractLeafKeys(en).sort();
  const esKeys = extractLeafKeys(es).sort();

  it("has exactly matching translation keys between en and es", () => {
    expect(enKeys).toEqual(esKeys);
  });

  it("contains non-empty string values for all keys in en and es", () => {
    function getValue(obj: any, path: string) {
      return path.split(".").reduce((acc, part) => acc?.[part], obj);
    }

    for (const key of enKeys) {
      const enVal = getValue(en, key);
      const esVal = getValue(es, key);

      expect(typeof enVal).toBe("string");
      expect(typeof esVal).toBe("string");
      expect((enVal as string).trim().length).toBeGreaterThan(0);
      expect((esVal as string).trim().length).toBeGreaterThan(0);
    }
  });

  it("includes all 15 activity event translations in both languages", () => {
    const events = [
      "card_created",
      "moved",
      "priority_changed",
      "title_changed",
      "description_changed",
      "points_changed",
      "due_date_changed",
      "type_changed",
      "label_added",
      "label_removed",
      "assigned",
      "unassigned",
      "comment_added",
      "archived",
      "unarchived",
    ];

    for (const evt of events) {
      expect(en.cardModal.events[evt as keyof typeof en.cardModal.events]).toBeTruthy();
      expect(es.cardModal.events[evt as keyof typeof es.cardModal.events]).toBeTruthy();
    }
  });
});
