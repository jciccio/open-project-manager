import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required — refusing to start with a guessable signing key."
  );
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/api/v1/auth/login",
  "/api/v1/auth/oidc/login",
  "/api/v1/auth/oidc/callback",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check Bearer Token header or Cookie
  let token = request.cookies.get("opm_session")?.value;
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  let isAuthenticated = false;
  if (token) {
    try {
      await jwtVerify(token, JWT_SECRET);
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Handle API v1 endpoints
  if (pathname.startsWith("/api/v1")) {
    if (!isAuthenticated && !isPublicPath) {
      return NextResponse.json(
        { error: "Unauthorized. Please provide a valid Bearer token or session cookie." },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Handle Page routes
  if (!isAuthenticated && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && isPublicPath) {
    const homeUrl = new URL("/", request.url);
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
