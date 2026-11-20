export const VALID_RELATION_TYPES = ["BLOCKS", "BLOCKED_BY", "RELATES_TO"] as const;
export type ValidRelationType = (typeof VALID_RELATION_TYPES)[number];

/**
 * The one stored form of a relation: BLOCKED_BY becomes a reversed BLOCKS, and RELATES_TO is
 * ordered by card id, so a relation and its inverse map to the same (source, target, type) row.
 */
export function normalizeRelation(
  sourceCardId: string,
  targetCardId: string,
  rawType: string
): { valid: false; error: string } | { valid: true; sourceId: string; targetId: string; type: ValidRelationType } {
  if (sourceCardId === targetCardId) {
    return { valid: false, error: "A card cannot relate to itself" };
  }
  const normType = (rawType || "").toUpperCase().trim();
  if (!VALID_RELATION_TYPES.includes(normType as ValidRelationType)) {
    return { valid: false, error: `Invalid relation type '${rawType}'. Expected BLOCKS, BLOCKED_BY, or RELATES_TO` };
  }
  if (normType === "BLOCKED_BY") {
    return { valid: true, sourceId: targetCardId, targetId: sourceCardId, type: "BLOCKS" };
  }
  if (normType === "RELATES_TO") {
    const [sourceId, targetId] = sourceCardId < targetCardId ? [sourceCardId, targetCardId] : [targetCardId, sourceCardId];
    return { valid: true, sourceId, targetId, type: "RELATES_TO" };
  }
  return { valid: true, sourceId: sourceCardId, targetId: targetCardId, type: "BLOCKS" };
}
