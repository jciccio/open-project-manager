-- AlterTable
ALTER TABLE "User" ADD COLUMN     "oidcSubject" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcSubject_key" ON "User"("oidcSubject");
