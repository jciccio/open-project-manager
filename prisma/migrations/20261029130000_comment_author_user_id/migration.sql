-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "authorUserId" TEXT;

-- CreateIndex
CREATE INDEX "Comment_authorUserId_idx" ON "Comment"("authorUserId");
