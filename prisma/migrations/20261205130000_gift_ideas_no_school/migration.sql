-- Phase 70d: gift ideas on a person, and the pet's weekend hours on no-school days.
-- AlterTable
ALTER TABLE "household" ADD COLUMN     "petNoSchoolDays" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "gift_idea" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "addedById" TEXT,
    "givenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_idea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gift_idea_personId_idx" ON "gift_idea"("personId");

-- AddForeignKey
ALTER TABLE "gift_idea" ADD CONSTRAINT "gift_idea_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_idea" ADD CONSTRAINT "gift_idea_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_idea" ADD CONSTRAINT "gift_idea_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

