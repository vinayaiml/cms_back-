CREATE TABLE "SubscriptionPlan" (
  "id" SERIAL NOT NULL,
  "stableKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanCapability" (
  "planId" INTEGER NOT NULL,
  "capabilityId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanCapability_pkey" PRIMARY KEY ("planId", "capabilityId")
);

CREATE UNIQUE INDEX "SubscriptionPlan_stableKey_key" ON "SubscriptionPlan"("stableKey");
CREATE INDEX "PlanCapability_capabilityId_idx" ON "PlanCapability"("capabilityId");

ALTER TABLE "PlanCapability" ADD CONSTRAINT "PlanCapability_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanCapability" ADD CONSTRAINT "PlanCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
