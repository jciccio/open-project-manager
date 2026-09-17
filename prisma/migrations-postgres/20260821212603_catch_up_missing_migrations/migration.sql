-- This table/index/constraint may already exist on a database whose owner
-- ran `prisma db push` (per this repo's own README) instead of
-- `migrate deploy` before this catch-up migration was added — the
-- IF NOT EXISTS / DO block guards keep this migration applicable either
-- way instead of failing `migrate deploy`.

-- CreateTable
CREATE TABLE IF NOT EXISTS "CardLink" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CardLink_cardId_idx" ON "CardLink"("cardId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CardLink_cardId_fkey'
    ) THEN
        ALTER TABLE "CardLink" ADD CONSTRAINT "CardLink_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
