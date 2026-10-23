-- Grown-ups only: a logged call or note, or a contact's notes, that kids don't see.
-- AlterTable
ALTER TABLE "interaction_log" ADD COLUMN     "adultsOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "notesAdultsOnly" BOOLEAN NOT NULL DEFAULT false;

