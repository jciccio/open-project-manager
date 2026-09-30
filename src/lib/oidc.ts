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

export type ResolveOidcUserError =
  | "missing_email"
  | "email_not_verified"
  | "link_required"
  | "linked_elsewhere"
  | "subject_in_use";

export type ResolveOidcUserResult = { ok: true; user: User } | { ok: false; error: ResolveOidcUserError };

// Lookup is oidcSubject-first because `sub` is stable for the life of the
// IdP account, while email can change. An unseen subject is never attached
// to an account that has a local password: whoever registered that email
// first could otherwise own the account the SSO user lands in. Those
// accounts link from the profile instead (linkUserId), which proves the
// person controls the local account too.
export async function resolveOidcUser(
  claims: OidcClaims,
  options: { linkUserId?: string } = {}
): Promise<ResolveOidcUserResult> {
  const existingBySubject = await db.user.findUnique({ where: { oidcSubject: claims.sub } });

  if (options.linkUserId) {
    if (existingBySubject) {
      return existingBySubject.id === options.linkUserId
        ? { ok: true, user: existingBySubject }
        : { ok: false, error: "subject_in_use" };
    }
    const target = await db.user.findUnique({ where: { id: options.linkUserId } });
    if (!target) return { ok: false, error: "link_required" };
    if (target.oidcSubject) return { ok: false, error: "linked_elsewhere" };
    const linked = await db.user.update({ where: { id: target.id }, data: { oidcSubject: claims.sub } });
    return { ok: true, user: linked };
  }

  if (existingBySubject) {
    return { ok: true, user: existingBySubject };
  }

  const email = claims.email?.toLowerCase().trim();
  if (!email) {
    return { ok: false, error: "missing_email" };
  }
  if (!claims.emailVerified) {
    return { ok: false, error: "email_not_verified" };
  }

  const existingByEmail = await db.user.findUnique({ where: { email } });
  if (existingByEmail) {
    if (existingByEmail.passwordHash) {
      return { ok: false, error: "link_required" };
    }
    if (existingByEmail.oidcSubject) {
      return { ok: false, error: "linked_elsewhere" };
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
