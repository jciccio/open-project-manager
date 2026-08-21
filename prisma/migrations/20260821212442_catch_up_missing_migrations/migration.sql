-- These tables/indexes may already exist on a database whose owner ran
-- `prisma db push` (per this repo's own README) instead of `migrate deploy`
-- before this catch-up migration was added — IF NOT EXISTS keeps this
-- migration applicable either way instead of failing `migrate deploy`.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filterJson" TEXT NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SavedView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CardLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardLink_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Activity_cardId_idx" ON "Activity"("cardId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SavedView_projectId_idx" ON "SavedView"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SavedView_name_projectId_key" ON "SavedView"("name", "projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CardLink_cardId_idx" ON "CardLink"("cardId");
