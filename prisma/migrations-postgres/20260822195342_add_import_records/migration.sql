-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportRecord_importRunId_idx" ON "ImportRecord"("importRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecord_userId_source_entityType_sourceId_key" ON "ImportRecord"("userId", "source", "entityType", "sourceId");

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
