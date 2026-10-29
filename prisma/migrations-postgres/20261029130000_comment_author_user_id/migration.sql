-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "authorUserId" TEXT;

-- CreateIndex
CREATE INDEX "Comment_authorUserId_idx" ON "Comment"("authorUserId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
