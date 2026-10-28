-- CreateIndex
CREATE INDEX "Column_projectId_idx" ON "Column"("projectId");

-- CreateIndex
CREATE INDEX "Card_columnId_idx" ON "Card"("columnId");

-- CreateIndex
CREATE INDEX "CardRelation_targetCardId_idx" ON "CardRelation"("targetCardId");

-- CreateIndex
CREATE INDEX "CardType_projectId_idx" ON "CardType"("projectId");

-- CreateIndex
CREATE INDEX "Label_projectId_idx" ON "Label"("projectId");

-- CreateIndex
CREATE INDEX "Label_userId_idx" ON "Label"("userId");

-- CreateIndex
CREATE INDEX "CardLabel_labelId_idx" ON "CardLabel"("labelId");

-- CreateIndex
CREATE INDEX "Comment_cardId_idx" ON "Comment"("cardId");

