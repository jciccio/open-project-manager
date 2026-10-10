-- DropIndex
DROP INDEX "User_oidcSubject_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "oidcIssuer" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User"("oidcIssuer", "oidcSubject");
