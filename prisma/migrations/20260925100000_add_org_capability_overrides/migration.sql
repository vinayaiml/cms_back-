CREATE TYPE "CapabilityOverrideEffect" AS ENUM ('ALLOW', 'DENY');

CREATE TABLE "OrganizationCapabilityOverride" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER NOT NULL,
  "capabilityId" INTEGER NOT NULL,
  "effect" "CapabilityOverrideEffect" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationCapabilityOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationCapabilityOverride_orgId_capabilityId_key" ON "OrganizationCapabilityOverride"("orgId", "capabilityId");
CREATE INDEX "OrganizationCapabilityOverride_capabilityId_idx" ON "OrganizationCapabilityOverride"("capabilityId");

ALTER TABLE "OrganizationCapabilityOverride" ADD CONSTRAINT "OrganizationCapabilityOverride_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationCapabilityOverride" ADD CONSTRAINT "OrganizationCapabilityOverride_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
