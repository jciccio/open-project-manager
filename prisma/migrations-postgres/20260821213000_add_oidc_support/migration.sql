-- Same `prisma db push`-before-this-migration scenario as the catch-up
-- migration: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS keep this
-- applicable on a database that already has these columns. DROP NOT NULL on
-- an already-nullable column is a no-op in Postgres, so it needs no guard.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "oidcSubject" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_oidcSubject_key" ON "User"("oidcSubject");
