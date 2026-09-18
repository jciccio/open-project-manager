-- The 20260911220000_add_project_members migration rebuilt the Project
-- table (SQLite's required pattern for adding a column) but never
-- recreated the Project_userId_key_key unique index that
-- 20260902223024_project_key_unique_per_user had added. Restore it.
-- SQLite only — the Postgres tree adds the visibility column via a plain
-- ALTER TABLE, which never touched the index.
CREATE UNIQUE INDEX "Project_userId_key_key" ON "Project"("userId", "key");
