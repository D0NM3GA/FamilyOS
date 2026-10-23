-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'OTHER');

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "contactCadenceDays" INTEGER;

-- CreateTable
CREATE TABLE "person_relationship" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_relationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_relationship_fromId_toId_type_key" ON "person_relationship"("fromId", "toId", "type");

-- AddForeignKey
ALTER TABLE "person_relationship" ADD CONSTRAINT "person_relationship_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_relationship" ADD CONSTRAINT "person_relationship_toId_fkey" FOREIGN KEY ("toId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
