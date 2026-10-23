-- AlterTable
ALTER TABLE "purchase_item" ADD COLUMN     "requestedById" TEXT;

-- AlterTable
ALTER TABLE "shopping_list_item" ADD COLUMN     "requestedById" TEXT;

-- AddForeignKey
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
