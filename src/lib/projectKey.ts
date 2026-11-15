import { db } from "@/lib/db";

export const MAX_PROJECT_KEY_LENGTH = 12;
const DERIVED_KEY_LENGTH = 6;

export function sanitizeProjectKey(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_PROJECT_KEY_LENGTH);
}

function deriveKeyFromName(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map((w) => w[0].toUpperCase()).join("").slice(0, DERIVED_KEY_LENGTH);
  }
  const clean = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return clean.slice(0, 4) || "PROJ";
}

export async function generateProjectKey(
  name: string,
  requestedKey: string | undefined,
  userId: string
): Promise<string> {
  const sanitizedRequested = requestedKey ? sanitizeProjectKey(requestedKey) : "";
  const base = sanitizedRequested || deriveKeyFromName(name);
  const maxLength = sanitizedRequested ? MAX_PROJECT_KEY_LENGTH : DERIVED_KEY_LENGTH;

  const existing = await db.project.findMany({
    where: { userId },
    select: { key: true },
  });
  const taken = new Set(existing.map((p) => p.key));

  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix++) {
    const suffixStr = String(suffix);
    const candidate = base.slice(0, maxLength - suffixStr.length) + suffixStr;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 3)}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}
