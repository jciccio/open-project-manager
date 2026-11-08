-- AlterTable
ALTER TABLE "Card" ADD COLUMN "messageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Card_projectId_messageId_key" ON "Card"("projectId", "messageId");
