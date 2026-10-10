-- CreateTable OrganizationConversationContext
CREATE TABLE "OrganizationConversationContext" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "companyOverview" TEXT,
    "operatingHours" TEXT,
    "locationDetails" TEXT,
    "visitorGuidelines" TEXT,
    "eventsSummary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationConversationContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable OrganizationApprovedQa
CREATE TABLE "OrganizationApprovedQa" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationApprovedQa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConversationContext_orgId_key" ON "OrganizationConversationContext"("orgId");

-- CreateIndex
CREATE INDEX "OrganizationApprovedQa_orgId_idx" ON "OrganizationApprovedQa"("orgId");

-- AddForeignKey
ALTER TABLE "OrganizationConversationContext" ADD CONSTRAINT "OrganizationConversationContext_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationApprovedQa" ADD CONSTRAINT "OrganizationApprovedQa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
