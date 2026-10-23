-- CreateTable
CREATE TABLE "item_price" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT,
    "totalCents" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCents" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_alias" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "textKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_alias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_price_productId_observedAt_idx" ON "item_price"("productId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_alias_householdId_textKey_key" ON "receipt_alias"("householdId", "textKey");

-- AddForeignKey
ALTER TABLE "item_price" ADD CONSTRAINT "item_price_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_price" ADD CONSTRAINT "item_price_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_price" ADD CONSTRAINT "item_price_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_alias" ADD CONSTRAINT "receipt_alias_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_alias" ADD CONSTRAINT "receipt_alias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "item_price_householdId_observedAt_idx" ON "item_price"("householdId", "observedAt");

