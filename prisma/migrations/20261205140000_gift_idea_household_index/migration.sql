-- Phase 70d: gift ideas are read and replaced by household (backups and restore).
CREATE INDEX "gift_idea_householdId_idx" ON "gift_idea"("householdId");
