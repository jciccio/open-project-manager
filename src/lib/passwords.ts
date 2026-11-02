import bcrypt from "bcryptjs";

const TIMING_EQUALIZER_HASH = bcrypt.hashSync("opm-login-timing-equalizer", 10);

// Always runs a bcrypt comparison, even when the account is missing or has no
// local password, so the response time doesn't reveal which emails exist.
export async function passwordMatches(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) {
    await bcrypt.compare(password, TIMING_EQUALIZER_HASH);
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

// An SSO-linked account signs in only through the IdP, so disabling the user
// there ends their access. OIDC_ALLOW_LOCAL_PASSWORD=true opts back in.
export function ssoAccountsKeepLocalPasswords(): boolean {
  return process.env.OIDC_ALLOW_LOCAL_PASSWORD === "true";
}

export function localPasswordAllowed(user: { oidcSubject: string | null }): boolean {
  return !user.oidcSubject || ssoAccountsKeepLocalPasswords();
}
