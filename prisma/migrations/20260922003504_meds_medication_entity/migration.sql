-- AlterTable
ALTER TABLE "task_instance" ADD COLUMN     "quantityConsumed" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "medication" (
    "id" TEXT NOT NULL,
    "taskDefinitionId" TEXT NOT NULL,
    "quantityOnHand" DOUBLE PRECISION,
    "doseAmount" DOUBLE PRECISION,
    "refillThresholdQuantity" DOUBLE PRECISION,
    "prescriberId" TEXT,
    "pharmacyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medication_taskDefinitionId_key" ON "medication"("taskDefinitionId");

-- AddForeignKey
ALTER TABLE "medication" ADD CONSTRAINT "medication_taskDefinitionId_fkey" FOREIGN KEY ("taskDefinitionId") REFERENCES "task_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication" ADD CONSTRAINT "medication_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication" ADD CONSTRAINT "medication_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
