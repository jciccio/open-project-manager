-- AlterTable
ALTER TABLE "Column" ADD COLUMN "group" TEXT NOT NULL DEFAULT 'UNSTARTED';
ALTER TABLE "Column" ADD COLUMN "color" TEXT;
ALTER TABLE "Column" ADD COLUMN "description" TEXT;

-- Backfill: done columns are COMPLETED. Columns still carrying the names the
-- app gives new projects get the matching group; everything else stays UNSTARTED.
UPDATE "Column" SET "group" = 'COMPLETED' WHERE "isDone" = true;
UPDATE "Column" SET "group" = 'BACKLOG' WHERE "isDone" = false AND "name" = 'Backlog';
UPDATE "Column" SET "group" = 'STARTED' WHERE "isDone" = false AND "name" = 'In Progress';
