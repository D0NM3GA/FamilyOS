-- Phase 65d: the meal plan.
-- CreateTable
CREATE TABLE "meal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_ingredient" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "meal_ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_day" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "mealId" TEXT,
    "note" TEXT,

    CONSTRAINT "meal_plan_day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_householdId_idx" ON "meal"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_ingredient_mealId_productId_key" ON "meal_ingredient"("mealId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_day_householdId_day_key" ON "meal_plan_day"("householdId", "day");

-- AddForeignKey
ALTER TABLE "meal" ADD CONSTRAINT "meal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_ingredient" ADD CONSTRAINT "meal_ingredient_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_ingredient" ADD CONSTRAINT "meal_ingredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_day" ADD CONSTRAINT "meal_plan_day_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_day" ADD CONSTRAINT "meal_plan_day_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

