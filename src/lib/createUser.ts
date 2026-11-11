import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const MIN_PASSWORD_LENGTH = 6;

export async function createPasswordUser(input: { name: string; email: string; password: string }) {
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();

  if (!name || !email || !input.password) {
    return { success: false as const, error: "All fields are required." };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { success: false as const, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` };
  }
  if (await db.user.findUnique({ where: { email } })) {
    return { success: false as const, error: "An account with this email already exists." };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await db.user.create({ data: { name, email, passwordHash } });
  return { success: true as const, user };
}
