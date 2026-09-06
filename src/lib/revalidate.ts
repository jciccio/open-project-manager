import { revalidatePath } from "next/cache";

export function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // no-op outside a request context (e.g. the stdio MCP server)
  }
}
