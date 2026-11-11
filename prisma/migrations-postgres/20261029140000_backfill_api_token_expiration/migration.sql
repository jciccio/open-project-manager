-- Backfill expiresAt for existing API tokens created before configurable expiration
UPDATE "ApiToken"
SET "expiresAt" = "createdAt" + INTERVAL '365 days'
WHERE "expiresAt" IS NULL;
