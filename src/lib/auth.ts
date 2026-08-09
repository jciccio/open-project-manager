import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = Uint8Array.from(
  Buffer.from(process.env.JWT_SECRET || "opm-open-project-manager-secret-key-2026")
);

const SESSION_COOKIE_NAME = "opm_session";
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds

export interface UserSession {
  userId: string;
  email: string;
  name: string;
}

export async function createSession(sessionData: UserSession) {
  const token = await new SignJWT({ ...sessionData })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(JWT_SECRET);

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
    const user = await verifyToken(bearerToken);
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
