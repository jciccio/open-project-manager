-- Backfill expiresAt for existing API tokens created before configurable expiration
UPDATE "ApiToken"
SET "expiresAt" = datetime("createdAt", '+365 days')
WHERE "expiresAt" IS NULL;
