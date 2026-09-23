import { z } from "zod";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export const MAX_URL_LENGTH = 2048;

export function isSafeUrl(value: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function safeHref(value: string | null | undefined): string | undefined {
  return value && isSafeUrl(value) ? value : undefined;
}

export const SafeUrlSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine(isSafeUrl, { message: "URL must use http, https or mailto" });
