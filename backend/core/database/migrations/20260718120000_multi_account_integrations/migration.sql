-- DropIndex
DROP INDEX "imported_items_userId_providerId_sourceId_key";

-- DropIndex
DROP INDEX "integrations_userId_providerId_key";

-- AlterTable
ALTER TABLE "imported_items" ADD COLUMN     "accountKey" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "accountKey" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "label" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "imported_items_userId_providerId_accountKey_sourceId_key" ON "imported_items"("userId", "providerId", "accountKey", "sourceId");

-- CreateIndex
CREATE INDEX "integrations_userId_providerId_idx" ON "integrations"("userId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_userId_providerId_accountKey_key" ON "integrations"("userId", "providerId", "accountKey");

