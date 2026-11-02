import type { z } from "zod";

export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

export function formatInputError(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const parsed = schema.safeParse(input);
  return parsed.success ? { success: true, data: parsed.data } : { success: false, error: formatInputError(parsed.error) };
}
