-- Three content tables become one.
--
-- `todos`, `calendar_events` and `notes` held the same shape of thing with
-- different column names: a title, a body, optionally a place in time. Keeping
-- them apart meant three sync entities, three controllers, and a "convert to a
-- note" path that had to delete a row and re-point every step, link and
-- reminder that referenced it.
--
-- Ids are carried over unchanged, which is what lets every foreign key keep
-- pointing at the same content: task_steps, reminders, links and the planner's
-- own blocks all continue to resolve without a lookup table.
--
-- NOTE ON ENCRYPTION: this migration moves ciphertext without touching it. The
-- AAD binds `userId:Model:field`, so a value sealed as `Todo:title` cannot be
-- opened as `Block:title`. Every migrated row therefore records what it was
-- sealed under in `legacyAadModel`, and the re-encryption pass
-- (scripts/reseal-blocks.ts) re-seals them and clears the column. Until that
-- runs, the rows are readable only through the legacy name — which is why the
-- column exists rather than the migration simply hoping.

-- ── enums ────────────────────────────────────────────────────────────────
CREATE TYPE "BlockKind" AS ENUM ('task', 'event', 'note');
CREATE TYPE "BlockSource" AS ENUM ('local', 'google', 'ticktick');

-- ── the table ────────────────────────────────────────────────────────────
CREATE TABLE "blocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "BlockKind" NOT NULL DEFAULT 'task',
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "location" TEXT,
    "status" "TodoStatus" NOT NULL DEFAULT 'todo',
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "deadline" TIMESTAMP(3),
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "category" "LifeArea",
    "estimatedDuration" INTEGER NOT NULL DEFAULT 30,
    "energyDemand" "EnergyLevel" NOT NULL DEFAULT 'medium',
    "desire" "Desire" NOT NULL DEFAULT 'neutral',
    "chunkable" BOOLEAN,
    "minChunk" INTEGER,
    "maxChunk" INTEGER,
    "recurrenceRule" TEXT,
    "preferredWindows" TEXT,
    "letGoAt" TIMESTAMP(3),
    "order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "BlockSource" NOT NULL DEFAULT 'local',
    "externalId" TEXT,
    "pinnedFields" TEXT,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "planForId" TEXT,
    "scheduleReason" TEXT,
    "legacyAadModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- ── rows whose owner is gone ─────────────────────────────────────────────
-- `calendar_events` never declared a foreign key to users, so deleting an
-- account left its events behind; production carries 3 such rows from 2 deleted
-- users. They cannot be recovered by anyone: a user's DEK is destroyed with the
-- account, so their titles are permanently unopenable ciphertext. `blocks` does
-- declare the key, which is why this has to be resolved here rather than
-- carried forward — and why it cannot happen again.
DELETE FROM "calendar_events" WHERE "userId" NOT IN (SELECT "id" FROM "users");
DELETE FROM "todos" WHERE "userId" NOT IN (SELECT "id" FROM "users");
DELETE FROM "notes" WHERE "userId" NOT IN (SELECT "id" FROM "users");

-- ── tasks ────────────────────────────────────────────────────────────────
INSERT INTO "blocks" (
  "id","userId","projectId","kind","parentId","title","body",
  "status","priority","deadline","startTime","endTime","category",
  "estimatedDuration","energyDemand","desire","chunkable","minChunk","maxChunk",
  "recurrenceRule","preferredWindows","letGoAt","order","source",
  "legacyAadModel","createdAt","updatedAt","version","deletedAt"
)
SELECT
  t."id", t."userId", t."projectId", 'task', t."parentTodoId", t."title", t."notes",
  t."status", t."priority", t."deadline", t."startTime", t."endTime", t."category",
  t."estimatedDuration", t."energyDemand", t."desire", t."chunkable", t."minChunk", t."maxChunk",
  t."recurrenceRule", t."preferredWindows", t."letGoAt", t."order", 'local',
  'Todo', t."createdAt", t."updatedAt", t."version", t."deletedAt"
FROM "todos" t;

-- ── events ───────────────────────────────────────────────────────────────
-- `bearai` was never a *source* in the sense google is — it meant "we made this
-- one", which is what `local` says. The old EventSource had no third option, so
-- the distinction that mattered (imported vs ours) was encoded in the same
-- column as the provider name.
INSERT INTO "blocks" (
  "id","userId","kind","title","body","location",
  "startTime","endTime","isFixed","recurrenceRule",
  "source","externalId","pinnedFields","planForId","scheduleReason",
  "estimatedDuration","legacyAadModel","createdAt","updatedAt","version","deletedAt"
)
SELECT
  e."id", e."userId", 'event', e."title", e."description", e."location",
  e."start", e."end", e."isFixed", e."recurrenceRule",
  CASE e."source"::text WHEN 'google' THEN 'google'::"BlockSource" ELSE 'local'::"BlockSource" END,
  e."externalId", e."pinnedFields", e."bearaiTaskId", e."scheduleReason",
  -- An event's duration was implicit in start/end; the unified row carries it
  -- explicitly because the planner reads it for every kind.
  GREATEST(1, (EXTRACT(EPOCH FROM (e."end" - e."start")) / 60)::int),
  'CalendarEvent', e."createdAt", e."updatedAt", e."version", e."deletedAt"
FROM "calendar_events" e;

-- ── notes ────────────────────────────────────────────────────────────────
INSERT INTO "blocks" (
  "id","userId","kind","title","body","source",
  "legacyAadModel","createdAt","updatedAt","version","deletedAt"
)
SELECT
  n."id", n."userId", 'note', n."title", n."bodyMarkdown", 'local',
  'Note', n."createdAt", n."updatedAt", n."version", n."deletedAt"
FROM "notes" n;

-- A planner block whose task was already gone would now be a dangling
-- self-reference, and the foreign key below would refuse the whole migration.
UPDATE "blocks" SET "planForId" = NULL
WHERE "planForId" IS NOT NULL
  AND "planForId" NOT IN (SELECT "id" FROM "blocks");

UPDATE "blocks" SET "parentId" = NULL
WHERE "parentId" IS NOT NULL
  AND "parentId" NOT IN (SELECT "id" FROM "blocks");

-- ── things that pointed at a todo ────────────────────────────────────────
ALTER TABLE "task_steps" ADD COLUMN "blockId" TEXT;
UPDATE "task_steps" SET "blockId" = "todoId";
DELETE FROM "task_steps" WHERE "blockId" IS NULL OR "blockId" NOT IN (SELECT "id" FROM "blocks");
ALTER TABLE "task_steps" ALTER COLUMN "blockId" SET NOT NULL;
ALTER TABLE "task_steps" DROP CONSTRAINT "task_steps_todoId_fkey";
DROP INDEX "task_steps_todoId_idx";
ALTER TABLE "task_steps" DROP COLUMN "todoId";

ALTER TABLE "time_logs" ADD COLUMN "blockId" TEXT;
UPDATE "time_logs" SET "blockId" = "todoId";
-- No foreign key here historically, so a log may outlive its task. Keeping the
-- row with a dangling id would break the NOT NULL the model declares, and the
-- log is only used to refine future estimates, so an orphan is worth nothing.
DELETE FROM "time_logs" WHERE "blockId" IS NULL;
ALTER TABLE "time_logs" ALTER COLUMN "blockId" SET NOT NULL;
DROP INDEX "time_logs_todoId_idx";
ALTER TABLE "time_logs" DROP COLUMN "todoId";

ALTER TABLE "focus_sessions" ADD COLUMN "blockId" TEXT;
UPDATE "focus_sessions" SET "blockId" = "todoId";
ALTER TABLE "focus_sessions" DROP COLUMN "todoId";

-- ── reminders ────────────────────────────────────────────────────────────
-- `targetType` is a free string rather than an enum; 'todo' and 'event' both
-- meant "a thing with a title and a time", which is now one thing.
UPDATE "reminders" SET "targetType" = 'block' WHERE "targetType" IN ('todo', 'event');

-- ── links ────────────────────────────────────────────────────────────────
-- The generated enum swap used a plain cast, which would abort on the first
-- 'todo' row because that value no longer exists. Map it explicitly instead.
CREATE TYPE "LinkFromType_new" AS ENUM ('block', 'capture');
ALTER TABLE "links"
  ALTER COLUMN "fromType" TYPE "LinkFromType_new"
  USING (CASE "fromType"::text WHEN 'capture' THEN 'capture' ELSE 'block' END::"LinkFromType_new"),
  ALTER COLUMN "toType" TYPE "LinkFromType_new"
  USING (CASE "toType"::text WHEN 'capture' THEN 'capture' ELSE 'block' END::"LinkFromType_new");
ALTER TYPE "LinkFromType" RENAME TO "LinkFromType_old";
ALTER TYPE "LinkFromType_new" RENAME TO "LinkFromType";
DROP TYPE "public"."LinkFromType_old";

-- ── the old tables ───────────────────────────────────────────────────────
DROP TABLE "calendar_events";
DROP TABLE "notes";
DROP TABLE "todos";
DROP TYPE "EventSource";

-- ── indexes and keys, after the data is in ───────────────────────────────
CREATE INDEX "blocks_projectId_idx" ON "blocks"("projectId");
CREATE INDEX "blocks_parentId_idx" ON "blocks"("parentId");
CREATE INDEX "blocks_userId_kind_status_idx" ON "blocks"("userId", "kind", "status");
CREATE INDEX "blocks_userId_kind_deadline_idx" ON "blocks"("userId", "kind", "deadline");
CREATE INDEX "blocks_userId_startTime_idx" ON "blocks"("userId", "startTime");
CREATE INDEX "blocks_userId_source_externalId_idx" ON "blocks"("userId", "source", "externalId");
CREATE INDEX "blocks_planForId_idx" ON "blocks"("planForId");
CREATE INDEX "blocks_userId_updatedAt_idx" ON "blocks"("userId", "updatedAt");
CREATE INDEX "task_steps_blockId_idx" ON "task_steps"("blockId");
CREATE INDEX "time_logs_blockId_idx" ON "time_logs"("blockId");

ALTER TABLE "blocks" ADD CONSTRAINT "blocks_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_planForId_fkey"
  FOREIGN KEY ("planForId") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_blockId_fkey"
  FOREIGN KEY ("blockId") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
