const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_ATTEMPTS = 5;
const EMAIL_LOCKOUT_MS = 15 * 60 * 1000;

const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 25;
const IP_LOCKOUT_MS = 15 * 60 * 1000;

interface Bucket {
  count: number;
  windowStartedAt: number;
  lockedUntil?: number;
}

const emailBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();

function checkBucket(
  buckets: Map<string, Bucket>,
  key: string,
  windowMs: number
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true };

  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000) };
  }

  if (now - bucket.windowStartedAt > windowMs) {
    buckets.delete(key);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailure(
  buckets: Map<string, Bucket>,
  key: string,
  windowMs: number,
  maxAttempts: number,
  lockoutMs: number
): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStartedAt > windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return;
  }

  bucket.count += 1;
  if (bucket.count >= maxAttempts) {
    bucket.lockedUntil = now + lockoutMs;
  }
}

// Per-IP limiting only applies when `ip` is provided - an absent IP is never folded into a shared bucket, which would let anyone's failed logins lock out every user on an unproxied deployment.
export function checkLoginRateLimit(
  email: string,
  ip?: string
): { allowed: boolean; retryAfterSeconds?: number } {
  const emailResult = checkBucket(emailBuckets, normalizeEmail(email), EMAIL_WINDOW_MS);
  if (!emailResult.allowed) return emailResult;

  if (ip) {
    const ipResult = checkBucket(ipBuckets, ip, IP_WINDOW_MS);
    if (!ipResult.allowed) return ipResult;
  }

  return { allowed: true };
}

export function recordLoginFailure(email: string, ip?: string): void {
  recordFailure(emailBuckets, normalizeEmail(email), EMAIL_WINDOW_MS, EMAIL_MAX_ATTEMPTS, EMAIL_LOCKOUT_MS);
  if (ip) {
    recordFailure(ipBuckets, ip, IP_WINDOW_MS, IP_MAX_ATTEMPTS, IP_LOCKOUT_MS);
  }
}

// Does not clear the IP bucket - an attacker holding one valid account could otherwise
// spray-fail on other emails from the same IP and reset the IP counter by logging in.
export function recordLoginSuccess(email: string): void {
  emailBuckets.delete(normalizeEmail(email));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Test-only: clears all rate-limit state. */
export function resetLoginRateLimit(): void {
  emailBuckets.clear();
  ipBuckets.clear();
}
