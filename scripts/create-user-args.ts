export interface CreateUserArgs {
  email: string;
  name: string;
}

export const CREATE_USER_USAGE = "Usage: yarn user:create --email <email> [--name <display name>]";

export function parseCreateUserArgs(argv: string[]): CreateUserArgs {
  let email: string | undefined;
  let name: string | undefined;

  const valueOf = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.trim() === "" || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    return value.trim();
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") email = valueOf(arg, argv[++i]);
    else if (arg === "--name") name = valueOf(arg, argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!email) throw new Error("--email is required");
  return { email, name: name ?? email.split("@")[0] };
}
