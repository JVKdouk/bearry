-- CreateTable
CREATE TABLE "imported_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "blockType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imported_items_userId_providerId_idx" ON "imported_items"("userId", "providerId");

-- CreateIndex
CREATE INDEX "imported_items_entityType_entityId_idx" ON "imported_items"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "imported_items_userId_providerId_sourceId_key" ON "imported_items"("userId", "providerId", "sourceId");
