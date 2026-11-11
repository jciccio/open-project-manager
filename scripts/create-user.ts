/**
 * Creates a password account once registration is closed, for an administrator
 * with access to the server. Prints a one-time temporary password, which the new
 * user changes under Profile Settings. Project owners can then add them from the
 * members modal.
 *
 *   yarn user:create --email jose@example.com --name "Jose"
 */
import { randomBytes } from "crypto";
import { db } from "../src/lib/db";
import { createPasswordUser } from "../src/lib/createUser";
import { CREATE_USER_USAGE, parseCreateUserArgs } from "./create-user-args";

async function main() {
  let args;
  try {
    args = parseCreateUserArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(CREATE_USER_USAGE);
    process.exit(2);
  }

  const password = randomBytes(12).toString("base64url");
  const result = await createPasswordUser({ name: args.name, email: args.email, password });
  if (!result.success) {
    console.error(result.error);
    process.exit(1);
  }

  console.log(`Created ${result.user.email} (${result.user.name}).`);
  console.log(`Temporary password: ${password}`);
  console.log("Share it privately; they can change it under Profile Settings after signing in.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
