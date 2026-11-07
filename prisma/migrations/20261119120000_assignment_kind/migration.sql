-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('HOMEWORK', 'TEST', 'QUIZ', 'PROJECT');

-- AlterTable
ALTER TABLE "school_assignment" ADD COLUMN     "kind" "AssignmentKind" NOT NULL DEFAULT 'HOMEWORK';
