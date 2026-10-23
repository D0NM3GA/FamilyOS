-- AlterEnum
ALTER TYPE "PersonRole" ADD VALUE 'ADMIN';

-- CreateTable
CREATE TABLE "integration_credential" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedValue" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_credential_householdId_provider_key" ON "integration_credential"("householdId", "provider");

-- AddForeignKey
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
