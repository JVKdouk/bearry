-- CreateEnum
CREATE TYPE "LifeArea" AS ENUM ('work', 'focus', 'personal', 'family', 'errand', 'sleep', 'meal', 'other');

-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "category" "LifeArea";

-- CreateTable
CREATE TABLE "block_regions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "category" "LifeArea" NOT NULL DEFAULT 'work',
    "dayMask" INTEGER NOT NULL DEFAULT 127,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "block_regions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "block_regions_userId_idx" ON "block_regions"("userId");
