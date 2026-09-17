import * as client from "openid-client";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

interface OidcEnv {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function readOidcEnv(): OidcEnv | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;

  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { issuerUrl, clientId, clientSecret, redirectUri };
}

export function isOidcConfigured(): boolean {
  return readOidcEnv() !== null;
}

export function getOidcRedirectUri(): string {
  const env = readOidcEnv();
  if (!env) throw new Error("OIDC is not configured");
  return env.redirectUri;
}

let discoveryPromise: Promise<client.Configuration> | null = null;

// Discovery does a network round-trip to the IdP, so the result is cached
// for the life of the process rather than re-fetched on every login attempt.
export async function getOidcConfig(): Promise<client.Configuration> {
  const env = readOidcEnv();
  if (!env) throw new Error("OIDC is not configured");

  if (!discoveryPromise) {
    discoveryPromise = client
      .discovery(new URL(env.issuerUrl), env.clientId, env.clientSecret)
      .catch((error) => {
        discoveryPromise = null;
        throw error;
      });
  }

  return discoveryPromise;
}

export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

export type ResolveOidcUserResult =
  | { ok: true; user: User }
  | { ok: false; error: "missing_email" | "email_not_verified" };

// Lookup is oidcSubject-first because `sub` is stable for the life of the
// IdP account, while email can change. Falling back to email only applies
// on a subject the app hasn't seen before, and only when the IdP asserts
// the email is verified — otherwise anyone who can register at the IdP
// with an unverified address could claim an existing local account.
export async function resolveOidcUser(claims: OidcClaims): Promise<ResolveOidcUserResult> {
  const existingBySubject = await db.user.findUnique({ where: { oidcSubject: claims.sub } });
  if (existingBySubject) {
    return { ok: true, user: existingBySubject };
  }

  const email = claims.email?.toLowerCase().trim();
  if (!email) {
    return { ok: false, error: "missing_email" };
  }

  const existingByEmail = await db.user.findUnique({ where: { email } });
  if (existingByEmail) {
    if (!claims.emailVerified) {
      return { ok: false, error: "email_not_verified" };
    }
    const linked = await db.user.update({
      where: { id: existingByEmail.id },
      data: { oidcSubject: claims.sub },
    });
    return { ok: true, user: linked };
  }

  const name = claims.name?.trim() || email;
  const created = await db.user.create({
    data: { email, name, oidcSubject: claims.sub },
  });
  return { ok: true, user: created };
}
