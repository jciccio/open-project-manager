import type { JWTPayload } from "jose";

export const TOKEN_ISSUER = "open-project-manager";
export const SESSION_AUDIENCE = "opm:session";
export const API_TOKEN_AUDIENCE = "opm:api";

// Tokens signed before iss/aud were added carry neither claim. They still
// verify until their own `exp`, at most 365 days after they were issued, so
// this legacy branch can be deleted once that window has passed.
export function hasAllowedClaims(payload: JWTPayload, audiences: string[]): boolean {
  if (payload.iss === undefined && payload.aud === undefined) return true;
  if (payload.iss !== TOKEN_ISSUER) return false;
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return tokenAudiences.every((aud) => typeof aud === "string" && audiences.includes(aud));
}
