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
