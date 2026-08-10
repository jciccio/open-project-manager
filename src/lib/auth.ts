import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";

const secretString = process.env.JWT_SECRET || "open-project-manager-secret-key-change-in-production";
const JWT_SECRET = Uint8Array.from(Buffer.from(secretString));

const SESSION_COOKIE_NAME = "opm_session";
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
const API_TOKEN_DURATION = 365 * 24 * 60 * 60; // 1 year in seconds

export interface UserSession {
  userId: string;
  email: string;
  name: string;
}

export async function signToken(sessionData: UserSession, durationSeconds = 30 * 24 * 60 * 60) {
  return await new SignJWT({ ...sessionData })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${durationSeconds}s`)
    .sign(JWT_SECRET);
}

// API tokens are JWTs carrying a `jti` that maps to an ApiToken row: the
// signature (unforgeable without JWT_SECRET) proves authenticity, and the DB
// row is revocation metadata only — deleting the row invalidates the token
// even though the JWT itself remains cryptographically valid until expiry.
export async function signApiToken(sessionData: UserSession, tokenId: string) {
  return await new SignJWT({ ...sessionData, jti: tokenId, type: "api_token" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${API_TOKEN_DURATION}s`)
    .sign(JWT_SECRET);
}

export async function createSession(sessionData: UserSession) {
  const token = await signToken(sessionData, SESSION_DURATION);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });

  return token;
}

export async function verifyToken(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      name: payload.name as string,
    };
  } catch (error) {
    return null;
  }
}

// Verifies a Bearer token that may be either a plain session JWT or an API
// token JWT (carries `jti`). API tokens are additionally checked against the
// ApiToken table so a deleted (revoked) row invalidates an otherwise
// still-valid signature.
async function verifyBearerToken(token: string): Promise<UserSession | null> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWT_SECRET));
  } catch {
    return null;
  }

  const jti = payload.jti as string | undefined;
  if (!jti) {
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      name: payload.name as string,
    };
  }

  const apiToken = await db.apiToken.findUnique({ where: { id: jti } });
  if (!apiToken || (apiToken.expiresAt && apiToken.expiresAt < new Date())) {
    return null;
  }

  await db.apiToken.update({
    where: { id: jti },
    data: { lastUsedAt: new Date() },
  });

  return {
    userId: payload.userId as string,
    email: payload.email as string,
    name: payload.name as string,
  };
}

export async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) return null;

    return await verifyToken(token);
  } catch (error) {
    return null;
  }
}

export async function getApiSession(request: NextRequest): Promise<UserSession | null> {
  // 1. Check Authorization Bearer header
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.substring(7).trim();
    const user = await verifyBearerToken(bearerToken);
    if (user) return user;
  }

  // 2. Check request cookie
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) {
    const user = await verifyToken(cookieToken);
    if (user) return user;
  }

  // 3. Fallback to server cookies()
  return await getSession();
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
