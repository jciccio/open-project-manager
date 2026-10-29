export const INTERNAL_ERROR_MESSAGE = "Internal error";

// Tools signal expected failures ("Card with ID … not found.") with a plain
// Error. Anything else (Prisma errors, TypeErrors, Node system errors, whose
// messages carry query shapes, code paths or file paths) stays server-side.
export function isPublicError(error: unknown): error is Error {
  return error instanceof Error && error.constructor === Error && !("code" in error);
}

export function publicErrorMessage(error: unknown, context: string): string {
  if (isPublicError(error)) return error.message;
  console.error(`MCP ${context} failed:`, error);
  return INTERNAL_ERROR_MESSAGE;
}
