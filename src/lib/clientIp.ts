// No missing-header fallback - a shared placeholder key would let unrelated callers share one bucket.
export function getClientIp(headers: Headers): string | undefined {
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) return undefined;
  const first = forwardedFor.split(",")[0]?.trim();
  return first || undefined;
}
