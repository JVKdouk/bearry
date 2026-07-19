-- DropIndex
DROP INDEX "block_regions_userId_idx";

-- DropIndex
DROP INDEX "calendar_events_userId_idx";

-- DropIndex
DROP INDEX "energy_windows_userId_idx";

-- DropIndex
DROP INDEX "links_userId_idx";

-- DropIndex
DROP INDEX "notes_userId_idx";

-- DropIndex
DROP INDEX "projects_userId_idx";

-- DropIndex
DROP INDEX "settings_userId_idx";

-- DropIndex
DROP INDEX "time_blocks_userId_idx";

-- DropIndex
DROP INDEX "todos_userId_idx";

-- CreateIndex
CREATE INDEX "block_regions_userId_updatedAt_idx" ON "block_regions"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "calendar_events_userId_updatedAt_idx" ON "calendar_events"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "energy_windows_userId_updatedAt_idx" ON "energy_windows"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "links_userId_updatedAt_idx" ON "links"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "notes_userId_updatedAt_idx" ON "notes"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "projects_userId_updatedAt_idx" ON "projects"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "settings_userId_updatedAt_idx" ON "settings"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "task_steps_userId_updatedAt_idx" ON "task_steps"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "time_blocks_userId_updatedAt_idx" ON "time_blocks"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "todos_userId_updatedAt_idx" ON "todos"("userId", "updatedAt");

