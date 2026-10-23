-- AlterTable
ALTER TABLE "household" ADD COLUMN     "petCareHours" JSONB;

-- CreateTable
CREATE TABLE "pet" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "bornAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAdvancedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_item" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "place" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_play" (
    "personId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_play_pkey" PRIMARY KEY ("personId","game")
);

-- CreateTable
CREATE TABLE "pet_memorial" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "form" INTEGER NOT NULL,
    "cause" TEXT NOT NULL,
    "ageMinutes" INTEGER NOT NULL,
    "favoriteToy" TEXT NOT NULL,
    "bornAt" TIMESTAMP(3) NOT NULL,
    "goneAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_memorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pet_personId_key" ON "pet"("personId");

-- CreateIndex
CREATE INDEX "pet_householdId_idx" ON "pet"("householdId");

-- CreateIndex
CREATE INDEX "pet_item_personId_idx" ON "pet_item"("personId");

-- CreateIndex
CREATE INDEX "pet_memorial_personId_goneAt_idx" ON "pet_memorial"("personId", "goneAt");

-- AddForeignKey
ALTER TABLE "pet" ADD CONSTRAINT "pet_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet" ADD CONSTRAINT "pet_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_item" ADD CONSTRAINT "pet_item_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_item" ADD CONSTRAINT "pet_item_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_play" ADD CONSTRAINT "pet_play_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_memorial" ADD CONSTRAINT "pet_memorial_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_memorial" ADD CONSTRAINT "pet_memorial_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
