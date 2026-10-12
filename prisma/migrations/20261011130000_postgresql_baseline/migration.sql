-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CapabilityOverrideEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('VIDEO', 'IMAGE', 'TEXT');

-- CreateEnum
CREATE TYPE "LessonVisibility" AS ENUM ('PRIVATE', 'PUBLIC_PREVIEW');

-- CreateEnum
CREATE TYPE "CourseVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "CourseSource" AS ENUM ('PLATFORM', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "CourseAccessType" AS ENUM ('FULL_COURSE', 'LEVEL_ONLY', 'CHAPTER_ONLY');

-- CreateEnum
CREATE TYPE "DashboardTemplateType" AS ENUM ('NONE', 'WIDGETS', 'KPI_OVERVIEW', 'MARKDOWN');

-- CreateTable
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "authorizedPersonName" TEXT NOT NULL,
    "contactNo" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "tenantVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "createdByUserId" INTEGER,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgPermission" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "OrgPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Robot" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT,
    "licenseKey" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "licenseStatus" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "appVersion" TEXT,
    "deviceModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deviceMetadata" JSONB,
    "licenseKeyCiphertext" TEXT,
    "licenseKeyFingerprint" TEXT,
    "hardwareCapabilities" JSONB,
    "hardwareModel" TEXT,
    "hardwareProfile" JSONB,

    CONSTRAINT "Robot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationConversationConfig" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "personaName" TEXT,
    "personaPrompt" TEXT,
    "greetingText" TEXT,
    "voiceStyle" TEXT,
    "language" TEXT,
    "tone" TEXT,
    "defaultLanguage" TEXT,
    "supportedLanguages" JSONB,
    "speechSpeed" DOUBLE PRECISION,
    "sessionMaxSeconds" INTEGER,
    "sessionIdleTimeoutSeconds" INTEGER,
    "cooldownSeconds" INTEGER,
    "dailySessionLimit" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationConversationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotConversationConfig" (
    "id" SERIAL NOT NULL,
    "robotId" INTEGER NOT NULL,
    "personaName" TEXT,
    "personaPrompt" TEXT,
    "greetingText" TEXT,
    "voiceStyle" TEXT,
    "language" TEXT,
    "tone" TEXT,
    "defaultLanguage" TEXT,
    "supportedLanguages" JSONB,
    "speechSpeed" DOUBLE PRECISION,
    "sessionMaxSeconds" INTEGER,
    "sessionIdleTimeoutSeconds" INTEGER,
    "cooldownSeconds" INTEGER,
    "dailySessionLimit" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotConversationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationConversationContext" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationConversationContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationApprovedQa" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationApprovedQa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "IdentityEmbeddingRecord" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "consentGranted" BOOLEAN NOT NULL DEFAULT false,
    "consentSource" TEXT NOT NULL,
    "consentPolicyVersion" TEXT NOT NULL,
    "consentGrantedAt" TIMESTAMP(3) NOT NULL,
    "embeddingCiphertext" TEXT,
    "embeddingFingerprint" TEXT,
    "embeddingSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "retentionExpiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityEmbeddingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityTemplate" (
    "id" SERIAL NOT NULL,
    "identityId" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "vectorCiphertext" TEXT NOT NULL,
    "vectorFingerprint" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "sourceRobotId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionModel" (
    "id" SERIAL NOT NULL,
    "modelId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "inputSize" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "minRamMb" INTEGER NOT NULL,
    "minAndroidApi" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "license" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecognitionModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationIdentityThreshold" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "accept" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "reject" DOUBLE PRECISION NOT NULL,
    "votes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationIdentityThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityRecognitionFeedback" (
    "id" SERIAL NOT NULL,
    "identityId" INTEGER,
    "modelId" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,
    "robotId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "votes" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityRecognitionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotIdentityIdempotency" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "robotId" INTEGER NOT NULL,
    "route" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotIdentityIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" SERIAL NOT NULL,
    "stableKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "version" INTEGER NOT NULL,
    "requiredHardware" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "UserCapabilityAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "capabilityId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCapabilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotCapabilityAssignment" (
    "id" SERIAL NOT NULL,
    "robotId" INTEGER NOT NULL,
    "capabilityId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotCapabilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "PlanCapability" (
    "planId" INTEGER NOT NULL,
    "capabilityId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanCapability_pkey" PRIMARY KEY ("planId","capabilityId")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" SERIAL NOT NULL,
    "courseCode" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "description" TEXT,
    "courseImageUrl" TEXT,
    "logoUrl" TEXT,
    "source" "CourseSource" NOT NULL DEFAULT 'PLATFORM',
    "ownerOrgId" INTEGER,
    "visibility" "CourseVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "introLevelId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" SERIAL NOT NULL,
    "levelId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "levelId" INTEGER NOT NULL,
    "chapterId" INTEGER,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT,
    "durationMins" INTEGER,
    "contentType" "ContentType" NOT NULL DEFAULT 'VIDEO',
    "contentUrl" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentSizeBytes" INTEGER,
    "contentChecksum" TEXT,
    "thumbnailUrl" TEXT,
    "logoUrl" TEXT,
    "visibility" "LessonVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgCourseAccess" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "accessType" "CourseAccessType" NOT NULL DEFAULT 'FULL_COURSE',
    "levelId" INTEGER,
    "chapterId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgCourseAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotCourseAccess" (
    "id" SERIAL NOT NULL,
    "robotId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "accessType" "CourseAccessType" NOT NULL DEFAULT 'FULL_COURSE',
    "levelId" INTEGER,
    "chapterId" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotCourseAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCourseAccess" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "accessType" "CourseAccessType" NOT NULL DEFAULT 'FULL_COURSE',
    "levelId" INTEGER,
    "chapterId" INTEGER,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCourseAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobotUsageLog" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "robotId" INTEGER NOT NULL,
    "courseId" INTEGER,
    "lessonId" INTEGER,
    "eventId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobotUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSection" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiredPermission" TEXT,
    "isSuperAdminOnly" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "templateType" "DashboardTemplateType" NOT NULL DEFAULT 'NONE',
    "templateConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "robotId" INTEGER,
    "courseId" INTEGER,
    "lessonId" INTEGER,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER,
    "actorOrgId" INTEGER,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetOrgId" INTEGER,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GlobalCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdByUserId_idx" ON "User"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_orgId_name_key" ON "Role"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "OrgPermission_orgId_idx" ON "OrgPermission"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPermission_orgId_permissionId_key" ON "OrgPermission"("orgId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permissionId_key" ON "UserPermission"("userId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Robot_serialNumber_key" ON "Robot"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Robot_licenseKey_key" ON "Robot"("licenseKey");

-- CreateIndex
CREATE UNIQUE INDEX "Robot_licenseKeyFingerprint_key" ON "Robot"("licenseKeyFingerprint");

-- CreateIndex
CREATE INDEX "Robot_orgId_idx" ON "Robot"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConversationConfig_orgId_key" ON "OrganizationConversationConfig"("orgId");

-- CreateIndex
CREATE INDEX "OrganizationConversationConfig_orgId_isPublished_idx" ON "OrganizationConversationConfig"("orgId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "RobotConversationConfig_robotId_key" ON "RobotConversationConfig"("robotId");

-- CreateIndex
CREATE INDEX "RobotConversationConfig_robotId_isPublished_idx" ON "RobotConversationConfig"("robotId", "isPublished");

-- CreateIndex
CREATE INDEX "OrganizationConversationContext_orgId_isPublished_idx" ON "OrganizationConversationContext"("orgId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationConversationContext_orgId_stableKey_key" ON "OrganizationConversationContext"("orgId", "stableKey");

-- CreateIndex
CREATE INDEX "OrganizationApprovedQa_orgId_isPublished_idx" ON "OrganizationApprovedQa"("orgId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationApprovedQa_orgId_stableKey_key" ON "OrganizationApprovedQa"("orgId", "stableKey");

-- CreateIndex
CREATE INDEX "ConversationPublicationRevision_orgId_scope_stableKey_idx" ON "ConversationPublicationRevision"("orgId", "scope", "stableKey");

-- CreateIndex
CREATE INDEX "ConversationPublicationRevision_orgId_robotId_idx" ON "ConversationPublicationRevision"("orgId", "robotId");

-- CreateIndex
CREATE INDEX "ConversationPublicationRevision_orgId_sourceType_version_idx" ON "ConversationPublicationRevision"("orgId", "sourceType", "version");

-- CreateIndex
CREATE INDEX "IdentityEmbeddingRecord_orgId_status_idx" ON "IdentityEmbeddingRecord"("orgId", "status");

-- CreateIndex
CREATE INDEX "IdentityEmbeddingRecord_orgId_retentionExpiresAt_idx" ON "IdentityEmbeddingRecord"("orgId", "retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityEmbeddingRecord_orgId_subjectRef_key" ON "IdentityEmbeddingRecord"("orgId", "subjectRef");

-- CreateIndex
CREATE INDEX "IdentityTemplate_identityId_modelId_qualityScore_idx" ON "IdentityTemplate"("identityId", "modelId", "qualityScore");

-- CreateIndex
CREATE INDEX "IdentityTemplate_sourceRobotId_idx" ON "IdentityTemplate"("sourceRobotId");

-- CreateIndex
CREATE UNIQUE INDEX "RecognitionModel_modelId_key" ON "RecognitionModel"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationIdentityThreshold_orgId_modelId_key" ON "OrganizationIdentityThreshold"("orgId", "modelId");

-- CreateIndex
CREATE INDEX "IdentityRecognitionFeedback_orgId_modelId_createdAt_idx" ON "IdentityRecognitionFeedback"("orgId", "modelId", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityRecognitionFeedback_identityId_outcome_createdAt_idx" ON "IdentityRecognitionFeedback"("identityId", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX "RobotIdentityIdempotency_createdAt_idx" ON "RobotIdentityIdempotency"("createdAt");

-- CreateIndex
CREATE INDEX "RobotIdentityIdempotency_expiresAt_idx" ON "RobotIdentityIdempotency"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RobotIdentityIdempotency_orgId_robotId_route_idempotencyKey_key" ON "RobotIdentityIdempotency"("orgId", "robotId", "route", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Capability_stableKey_key" ON "Capability"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_stableKey_key" ON "SubscriptionPlan"("stableKey");

-- CreateIndex
CREATE INDEX "UserCapabilityAssignment_capabilityId_idx" ON "UserCapabilityAssignment"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCapabilityAssignment_userId_capabilityId_key" ON "UserCapabilityAssignment"("userId", "capabilityId");

-- CreateIndex
CREATE INDEX "RobotCapabilityAssignment_capabilityId_idx" ON "RobotCapabilityAssignment"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "RobotCapabilityAssignment_robotId_capabilityId_key" ON "RobotCapabilityAssignment"("robotId", "capabilityId");

-- CreateIndex
CREATE INDEX "OrganizationCapabilityOverride_capabilityId_idx" ON "OrganizationCapabilityOverride"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCapabilityOverride_orgId_capabilityId_key" ON "OrganizationCapabilityOverride"("orgId", "capabilityId");

-- CreateIndex
CREATE INDEX "OrganizationSubscription_orgId_idx" ON "OrganizationSubscription"("orgId");

-- CreateIndex
CREATE INDEX "OrganizationSubscription_planId_idx" ON "OrganizationSubscription"("planId");

-- CreateIndex
CREATE INDEX "PlanCapability_capabilityId_idx" ON "PlanCapability"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_courseCode_key" ON "Course"("courseCode");

-- CreateIndex
CREATE UNIQUE INDEX "Course_introLevelId_key" ON "Course"("introLevelId");

-- CreateIndex
CREATE INDEX "Course_ownerOrgId_idx" ON "Course"("ownerOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Level_courseId_sequence_key" ON "Level"("courseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_levelId_sequence_key" ON "Chapter"("levelId", "sequence");

-- CreateIndex
CREATE INDEX "Lesson_courseId_levelId_idx" ON "Lesson"("courseId", "levelId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_courseId_levelId_sequence_key" ON "Lesson"("courseId", "levelId", "sequence");

-- CreateIndex
CREATE INDEX "OrgCourseAccess_orgId_idx" ON "OrgCourseAccess"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgCourseAccess_orgId_courseId_accessType_levelId_chapterId_key" ON "OrgCourseAccess"("orgId", "courseId", "accessType", "levelId", "chapterId");

-- CreateIndex
CREATE INDEX "RobotCourseAccess_robotId_idx" ON "RobotCourseAccess"("robotId");

-- CreateIndex
CREATE INDEX "RobotCourseAccess_courseId_idx" ON "RobotCourseAccess"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "RobotCourseAccess_robotId_courseId_accessType_levelId_chapt_key" ON "RobotCourseAccess"("robotId", "courseId", "accessType", "levelId", "chapterId");

-- CreateIndex
CREATE INDEX "UserCourseAccess_userId_idx" ON "UserCourseAccess"("userId");

-- CreateIndex
CREATE INDEX "UserCourseAccess_courseId_idx" ON "UserCourseAccess"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCourseAccess_userId_courseId_accessType_levelId_chapter_key" ON "UserCourseAccess"("userId", "courseId", "accessType", "levelId", "chapterId");

-- CreateIndex
CREATE INDEX "RobotUsageLog_orgId_robotId_idx" ON "RobotUsageLog"("orgId", "robotId");

-- CreateIndex
CREATE UNIQUE INDEX "RobotUsageLog_robotId_eventId_key" ON "RobotUsageLog"("robotId", "eventId");

-- CreateIndex
CREATE INDEX "Notification_orgId_userId_idx" ON "Notification"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_orgId_type_message_key" ON "Notification"("orgId", "type", "message");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSection_key_key" ON "DashboardSection"("key");

-- CreateIndex
CREATE INDEX "Event_orgId_type_idx" ON "Event"("orgId", "type");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetOrgId_createdAt_idx" ON "AuditEvent"("targetOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPermission" ADD CONSTRAINT "OrgPermission_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPermission" ADD CONSTRAINT "OrgPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Robot" ADD CONSTRAINT "Robot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationConversationConfig" ADD CONSTRAINT "OrganizationConversationConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotConversationConfig" ADD CONSTRAINT "RobotConversationConfig_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationConversationContext" ADD CONSTRAINT "OrganizationConversationContext_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationApprovedQa" ADD CONSTRAINT "OrganizationApprovedQa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationPublicationRevision" ADD CONSTRAINT "ConversationPublicationRevision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityEmbeddingRecord" ADD CONSTRAINT "IdentityEmbeddingRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityTemplate" ADD CONSTRAINT "IdentityTemplate_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "IdentityEmbeddingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityTemplate" ADD CONSTRAINT "IdentityTemplate_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RecognitionModel"("modelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationIdentityThreshold" ADD CONSTRAINT "OrganizationIdentityThreshold_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationIdentityThreshold" ADD CONSTRAINT "OrganizationIdentityThreshold_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RecognitionModel"("modelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRecognitionFeedback" ADD CONSTRAINT "IdentityRecognitionFeedback_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "IdentityEmbeddingRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityRecognitionFeedback" ADD CONSTRAINT "IdentityRecognitionFeedback_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RecognitionModel"("modelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapabilityAssignment" ADD CONSTRAINT "UserCapabilityAssignment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapabilityAssignment" ADD CONSTRAINT "UserCapabilityAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotCapabilityAssignment" ADD CONSTRAINT "RobotCapabilityAssignment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotCapabilityAssignment" ADD CONSTRAINT "RobotCapabilityAssignment_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCapabilityOverride" ADD CONSTRAINT "OrganizationCapabilityOverride_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCapabilityOverride" ADD CONSTRAINT "OrganizationCapabilityOverride_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanCapability" ADD CONSTRAINT "PlanCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanCapability" ADD CONSTRAINT "PlanCapability_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_introLevelId_fkey" FOREIGN KEY ("introLevelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerOrgId_fkey" FOREIGN KEY ("ownerOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgCourseAccess" ADD CONSTRAINT "OrgCourseAccess_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgCourseAccess" ADD CONSTRAINT "OrgCourseAccess_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotCourseAccess" ADD CONSTRAINT "RobotCourseAccess_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotCourseAccess" ADD CONSTRAINT "RobotCourseAccess_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourseAccess" ADD CONSTRAINT "UserCourseAccess_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourseAccess" ADD CONSTRAINT "UserCourseAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotUsageLog" ADD CONSTRAINT "RobotUsageLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotUsageLog" ADD CONSTRAINT "RobotUsageLog_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotUsageLog" ADD CONSTRAINT "RobotUsageLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotUsageLog" ADD CONSTRAINT "RobotUsageLog_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

