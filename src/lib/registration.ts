import { db } from "@/lib/db";

export async function isRegistrationOpen(): Promise<boolean> {
  if (process.env.OPM_ALLOW_REGISTRATION === "true") return true;
  return (await db.user.count()) === 0;
}
