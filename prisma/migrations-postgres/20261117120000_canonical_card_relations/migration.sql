-- Store each relation in one form: BLOCKED_BY as the reversed BLOCKS, and RELATES_TO
-- ordered by card id. A row whose canonical form already exists is a duplicate and is dropped.
-- COLLATE "C" orders ids by byte value, the same order the application's string comparison uses.
DELETE FROM "CardRelation"
WHERE "type" = 'BLOCKED_BY'
  AND EXISTS (
    SELECT 1 FROM "CardRelation" AS c
    WHERE c."sourceCardId" = "CardRelation"."targetCardId"
      AND c."targetCardId" = "CardRelation"."sourceCardId"
      AND c."type" = 'BLOCKS'
  );

UPDATE "CardRelation"
SET "sourceCardId" = "targetCardId", "targetCardId" = "sourceCardId", "type" = 'BLOCKS'
WHERE "type" = 'BLOCKED_BY';

DELETE FROM "CardRelation"
WHERE "type" = 'RELATES_TO'
  AND "sourceCardId" COLLATE "C" > "targetCardId" COLLATE "C"
  AND EXISTS (
    SELECT 1 FROM "CardRelation" AS c
    WHERE c."sourceCardId" = "CardRelation"."targetCardId"
      AND c."targetCardId" = "CardRelation"."sourceCardId"
      AND c."type" = 'RELATES_TO'
  );

UPDATE "CardRelation"
SET "sourceCardId" = "targetCardId", "targetCardId" = "sourceCardId"
WHERE "type" = 'RELATES_TO'
  AND "sourceCardId" COLLATE "C" > "targetCardId" COLLATE "C";
