CREATE TABLE "ConversationPublicationRevision" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "robotId" INTEGER,
    "scope" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" INTEGER,
    "stableKey" TEXT,
    "version" INTEGER NOT NULL,
    "previousVersion" INTEGER,
    "snapshot" JSONB NOT NULL,
    "publishedByUserId" INTEGER,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "restoredFromRevisionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationPublicationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationPublicationRevision_orgId_scope_stableKey_idx" ON "ConversationPublicationRevision"("orgId", "scope", "stableKey");
CREATE INDEX "ConversationPublicationRevision_orgId_robotId_idx" ON "ConversationPublicationRevision"("orgId", "robotId");
CREATE INDEX "ConversationPublicationRevision_orgId_sourceType_version_idx" ON "ConversationPublicationRevision"("orgId", "sourceType", "version");

ALTER TABLE "ConversationPublicationRevision" ADD CONSTRAINT "ConversationPublicationRevision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
