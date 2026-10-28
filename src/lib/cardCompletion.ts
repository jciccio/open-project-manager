export function deriveCompletedAt(
  isDone: boolean | undefined,
  existingCompletedAt: Date | null | undefined
): Date | null {
  return isDone ? existingCompletedAt ?? new Date() : null;
}
