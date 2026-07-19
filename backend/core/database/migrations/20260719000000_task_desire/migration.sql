-- CreateEnum
CREATE TYPE "Desire" AS ENUM ('wanted', 'neutral', 'avoided');

-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "desire" "Desire" NOT NULL DEFAULT 'neutral';

