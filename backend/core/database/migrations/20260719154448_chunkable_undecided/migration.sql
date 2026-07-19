-- `chunkable` becomes three-valued: true / false / undecided.
ALTER TABLE "todos" ALTER COLUMN "chunkable" DROP NOT NULL,
ALTER COLUMN "chunkable" DROP DEFAULT;

-- Every existing `false` is the old column default, not a decision: there has
-- never been a control in the app for turning splitting off, so nobody can have
-- chosen it. Leaving them as false would freeze every existing long task as
-- unsplittable — exactly the bug this change exists to fix — so they're reset
-- to undecided and pick up the duration rule.
--
-- `true` is left alone: that one could only ever have been set deliberately.
UPDATE "todos" SET "chunkable" = NULL WHERE "chunkable" = false;
