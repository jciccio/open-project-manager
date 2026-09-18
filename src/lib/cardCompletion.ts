/**
 * Derives a card's completedAt when it lands in (or is created in) a column,
 * given whether that column is a "Done" column. An already-set completedAt
 * is preserved rather than overwritten, so re-entering a Done column keeps
 * the original completion timestamp.
 */
export function deriveCompletedAt(
  isDone: boolean | undefined,
  existingCompletedAt: Date | null | undefined
): Date | null {
  return isDone ? existingCompletedAt ?? new Date() : null;
}
