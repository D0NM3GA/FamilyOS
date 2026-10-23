-- Phase 40.2: the sign-in audit log (lib/sign-in-events.ts). Append-only; first names are kept
-- as they were, so an entry still reads right after its people are gone.
-- CreateEnum
CREATE TYPE "SignInEventKind" AS ENUM ('PASSKEY_ADDED', 'PASSKEY_REMOVED', 'INVITE_MADE', 'INVITE_CANCELLED', 'INVITE_ACCEPTED', 'PASSKEYS_RESET', 'SIGN_IN_REMOVED', 'ROLE_CHANGED');

-- CreateTable
CREATE TABLE "sign_in_event" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" "SignInEventKind" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectName" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_in_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sign_in_event_householdId_createdAt_idx" ON "sign_in_event"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "sign_in_event_subjectId_createdAt_idx" ON "sign_in_event"("subjectId", "createdAt");

-- AddForeignKey
ALTER TABLE "sign_in_event" ADD CONSTRAINT "sign_in_event_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_event" ADD CONSTRAINT "sign_in_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_event" ADD CONSTRAINT "sign_in_event_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

