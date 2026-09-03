const MIN_JWT_SECRET_LENGTH = 32;

function requireJwtSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET environment variable is required and must be at least ${MIN_JWT_SECRET_LENGTH} characters - refusing to start with a missing or weak signing key.`
    );
  }
  return new TextEncoder().encode(raw);
}

export const JWT_SECRET = requireJwtSecret();
