import { cookies, headers } from "next/headers";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { JWT_SECRET } from "@/lib/env";
import { API_TOKEN_AUDIENCE, SESSION_AUDIENCE, TOKEN_ISSUER, hasAllowedClaims } from "@/lib/tokenClaims";

const SESSION_COOKIE_NAME = "opm_session";
export const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
const API_TOKEN_DURATION = 365 * 24 * 60 * 60; // 1 year in seconds

export interface UserSession {
  userId: string;
  email: string;
  name: string;
  tokenVersion?: number;
}

// Tokens issued before tokenVersion existed carry no `tv` claim; they count as
// version 0 so upgrading does not sign everyone out.
function tokenVersionClaim(payload: { tv?: unknown }): number {
  return typeof payload.tv === "number" ? payload.tv : 0;
}

function sessionFromPayload(payload: Record<string, unknown>): UserSession {
  return {
    userId: payload.userId as string,
    email: payload.email as string,
    name: payload.name as string,
    tokenVersion: tokenVersionClaim(payload),
  };
}

function toClaims({ userId, email, name, tokenVersion }: UserSession) {
  return { userId, email, name, tv: tokenVersion ?? 0 };
}

export async function determineCookieSecurity(): Promise<boolean> {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;

  if (process.env.NODE_ENV !== "production") return false;

  // In production, detect plain HTTP access (e.g. LAN IP like http://192.168.x.x:3000)
  // Browsers reject cookies with the `Secure` attribute when sent over non-HTTPS connections.
  try {
    const headerList = await headers();
    const proto = headerList.get("x-forwarded-proto");
    const referer = headerList.get("referer");
    const origin = headerList.get("origin");

    if (proto === "http") return false;
    if (referer && referer.startsWith("http://")) return false;
    if (origin && origin.startsWith("http://")) return false;
  } catch {
    // headers() might be unavailable outside request context
  }

  return true;
}

export async function signToken(sessionData: UserSession, durationSeconds = 30 * 24 * 60 * 60) {
  return await new SignJWT(toClaims(sessionData))
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${durationSeconds}s`)
    .sign(JWT_SECRET);
}

// API tokens are JWTs carrying a `jti` that maps to an ApiToken row: the
// signature (unforgeable without JWT_SECRET) proves authenticity, and the DB
// row is revocation metadata only — deleting the row invalidates the token
// even though the JWT itself remains cryptographically valid until expiry.
export async function signApiToken(
  sessionData: UserSession,
  tokenId: string,
  expiresAt?: Date | null
) {
  const jwt = new SignJWT({ ...toClaims(sessionData), jti: tokenId, type: "api_token" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .setIssuedAt();

  if (expiresAt) {
    jwt.setExpirationTime(Math.floor(expiresAt.getTime() / 1000));
  } else if (expiresAt === undefined) {
    jwt.setExpirationTime(`${API_TOKEN_DURATION}s`);
  }

  return await jwt.sign(JWT_SECRET);
}

export async function createSession(sessionData: UserSession) {
  const token = await signToken(sessionData, SESSION_DURATION);
  const isSecure = await determineCookieSecurity();

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });

  return token;
}

// Verifies a plain session JWT. API-token JWTs (carrying `jti`/`type:
// "api_token"`) are rejected here even if the signature is valid — session
// verification must never accept an API token, since that would bypass the
// ApiToken revocation check in verifyBearerToken and let a revoked token
// stay valid as a cookie until the JWT itself expires.
export async function verifyToken(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.jti || payload.type === "api_token") return null;
    if (!hasAllowedClaims(payload, [SESSION_AUDIENCE])) return null;
    return sessionFromPayload(payload);
  } catch (error) {
    return null;
  }
}

const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

// Verifies a Bearer token that may be either a plain session JWT or an API
// token JWT (carries `jti`). API tokens are additionally checked against the
// ApiToken table so a deleted (revoked) row invalidates an otherwise
// still-valid signature.
async function verifyBearerToken(token: string): Promise<UserSession | null> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] }));
  } catch {
    return null;
  }
  if (!hasAllowedClaims(payload, [SESSION_AUDIENCE, API_TOKEN_AUDIENCE])) return null;

  const jti = payload.jti as string | undefined;
  if (!jti) return sessionFromPayload(payload);

  const apiToken = await db.apiToken.findUnique({ where: { id: jti } });
  if (!apiToken || (apiToken.expiresAt && apiToken.expiresAt < new Date())) {
    return null;
  }

  if (!apiToken.lastUsedAt || Date.now() - apiToken.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await db.apiToken.update({
      where: { id: jti },
      data: { lastUsedAt: new Date() },
    });
  }

  return sessionFromPayload(payload);
}

// A token is only honoured while its `tv` matches the user's current
// tokenVersion; bumping the column (scripts/revoke-user.ts) ends every session
// and API token the user holds.
async function currentUserFor(session: UserSession): Promise<UserSession | null> {
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, tokenVersion: true },
  });
  if (!user || user.tokenVersion !== session.tokenVersion) return null;
  return { userId: user.id, email: user.email, name: user.name, tokenVersion: user.tokenVersion };
}

export async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) return null;

    const session = await verifyToken(token);
    if (!session) return null;

    const current = await currentUserFor(session);
    if (!current) {
      try {
        cookieStore.delete(SESSION_COOKIE_NAME);
      } catch {
        // cookies() delete may be ignored in read-only render contexts
      }
      return null;
    }

    return current;
  } catch (error) {
    return null;
  }
}

export async function getApiSession(request: NextRequest): Promise<UserSession | null> {
  // 1. Check Authorization Bearer header
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.substring(7).trim();
    const session = await verifyBearerToken(bearerToken);
    if (session) return await currentUserFor(session);
  }

  // 2. Check request cookie
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) {
    const session = await verifyToken(cookieToken);
    if (session) return await currentUserFor(session);
  }

  // 3. Fallback to server cookies()
  return await getSession();
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
