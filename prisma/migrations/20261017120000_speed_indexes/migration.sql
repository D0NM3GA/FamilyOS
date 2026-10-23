-- Foreign keys and sort columns the busy pages filter on (Postgres doesn't index foreign
-- keys by itself): the sticker ledger, chore/med boards, trips, the shopping list, People.
-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "important_date_personId_idx" ON "important_date"("personId");

-- CreateIndex
CREATE INDEX "interaction_log_personId_occurredAt_idx" ON "interaction_log"("personId", "occurredAt");

-- CreateIndex
CREATE INDEX "person_householdId_idx" ON "person"("householdId");

-- CreateIndex
CREATE INDEX "points_ledger_personId_idx" ON "points_ledger"("personId");

-- CreateIndex
CREATE INDEX "points_ledger_instanceId_idx" ON "points_ledger"("instanceId");

-- CreateIndex
CREATE INDEX "privacy_charge_matchedTxnId_idx" ON "privacy_charge"("matchedTxnId");

-- CreateIndex
CREATE INDEX "purchase_householdId_purchasedAt_idx" ON "purchase"("householdId", "purchasedAt");

-- CreateIndex
CREATE INDEX "purchase_item_purchaseId_idx" ON "purchase_item"("purchaseId");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "shopping_list_item_listId_idx" ON "shopping_list_item"("listId");

-- CreateIndex
CREATE INDEX "task_definition_householdId_domain_active_idx" ON "task_definition"("householdId", "domain", "active");

-- CreateIndex
CREATE INDEX "task_instance_assignedToId_dueDate_idx" ON "task_instance"("assignedToId", "dueDate");

-- CreateIndex
CREATE INDEX "task_instance_completedAt_idx" ON "task_instance"("completedAt");

