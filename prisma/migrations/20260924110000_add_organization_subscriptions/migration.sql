CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "OrganizationSubscription" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER NOT NULL,
  "planId" INTEGER NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationSubscription_orgId_idx" ON "OrganizationSubscription"("orgId");
CREATE INDEX "OrganizationSubscription_planId_idx" ON "OrganizationSubscription"("planId");

ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
