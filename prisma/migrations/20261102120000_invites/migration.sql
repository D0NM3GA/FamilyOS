-- Phase 40.2b: invites for grown-ups to sign in on their own (lib/invites.ts). Tokens are
-- stored hashed; an invite is single use and lasts 48 hours.
-- CreateTable
CREATE TABLE "invite" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "personId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "role" "PersonRole" NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokenHash_key" ON "invite"("tokenHash");

-- CreateIndex
CREATE INDEX "invite_householdId_expiresAt_idx" ON "invite"("householdId", "expiresAt");

-- CreateIndex
CREATE INDEX "invite_personId_idx" ON "invite"("personId");

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

