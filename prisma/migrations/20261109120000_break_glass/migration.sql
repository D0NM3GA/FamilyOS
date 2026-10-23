-- CreateTable
CREATE TABLE "break_glass_notice" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_glass_notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "break_glass_notice_householdId_endedAt_idx" ON "break_glass_notice"("householdId", "endedAt");
