/**
 * Ends every session and API token a user holds, for offboarding.
 *
 * Runs on the machine that owns the database. Pair it with disabling the user
 * in the IdP: SSO-linked accounts cannot sign in with a password (unless
 * OIDC_ALLOW_LOCAL_PASSWORD=true), so once both are done they have no way back in.
 *
 *   npx tsx scripts/revoke-user.ts --user jose@example.com
 */
import { db } from "../src/lib/db";
import { revokeUserAccess } from "../src/lib/revokeUser";

async function main() {
  const argv = process.argv.slice(2);
  const flagIndex = argv.indexOf("--user");
  const identifier = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  if (!identifier || argv.length !== 2) {
    console.error("Usage: yarn user:revoke --user <email or user id>");
    process.exit(2);
  }

  const result = await revokeUserAccess(identifier);
  if (!result) {
    console.error(`No user matches "${identifier}" (pass an email or a user id)`);
    process.exit(1);
  }

  console.log(
    `Revoked access for ${result.email}: all sessions ended (token version ${result.tokenVersion}), ` +
      `${result.deletedApiTokens} API token(s) deleted.`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
