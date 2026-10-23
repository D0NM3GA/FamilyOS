-- CreateTable
CREATE TABLE "pet_discovery" (
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "form" INTEGER NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_discovery_pkey" PRIMARY KEY ("personId","species","stage","form")
);

-- CreateIndex
CREATE INDEX "pet_discovery_householdId_idx" ON "pet_discovery"("householdId");

-- AddForeignKey
ALTER TABLE "pet_discovery" ADD CONSTRAINT "pet_discovery_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_discovery" ADD CONSTRAINT "pet_discovery_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
