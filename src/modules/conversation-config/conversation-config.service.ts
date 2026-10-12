import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  UpsertApprovedQaDto,
  UpsertConversationConfigDto,
  UpsertConversationContextDto,
} from "./conversation-config.dto";

type Actor = {
  userId: number;
  orgId: number | null;
  isSuperAdmin: boolean;
};

type ConfigRecord = {
  id: number;
  personaName: string | null;
  personaPrompt: string | null;
  greetingText: string | null;
  voiceStyle: string | null;
  language: string | null;
  tone: string | null;
  defaultLanguage: string | null;
  supportedLanguages: Prisma.JsonValue | null;
  speechSpeed: number | null;
  sessionMaxSeconds: number | null;
  sessionIdleTimeoutSeconds: number | null;
  cooldownSeconds: number | null;
  dailySessionLimit: number | null;
  isPublished: boolean;
  version: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

type ContextRecord = {
  id: number;
  stableKey: string;
  contextType: string;
  title: string;
  body: string;
  isPublished: boolean;
  version: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

type QaRecord = {
  id: number;
  stableKey: string;
  question: string;
  answer: string;
  isPublished: boolean;
  version: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

type RevisionRecord = {
  id: number;
  orgId: number;
  robotId: number | null;
  scope: string;
  sourceType: string;
  sourceId: number | null;
  stableKey: string | null;
  version: number;
  previousVersion: number | null;
  snapshot: Prisma.JsonValue;
  publishedByUserId: number | null;
  publishedAt: Date;
  restoredFromRevisionId: number | null;
  createdAt: Date;
};

type PublicationSource =
  | "organization_config"
  | "robot_config"
  | "conversation_context"
  | "approved_qa";

const SYSTEM_DEFAULT_CONFIG = {
  personaName: "WhizRobot Assistant",
  personaPrompt:
    "Use only approved CMS context and registered tools. Do not reveal private data or backend configuration.",
  greetingText: "Hello, I am your WhizRobot assistant.",
  voiceStyle: "friendly",
  language: "en",
  tone: "helpful",
};

const SYSTEM_DEFAULT_POLICIES = {
  defaultLanguage: "en",
  supportedLanguages: ["en"],
  speechSpeed: 1,
  sessionMaxSeconds: 600,
  sessionIdleTimeoutSeconds: 120,
  cooldownSeconds: 5,
  dailySessionLimit: 50,
};

const CONFIG_FIELDS = [
  "personaName",
  "personaPrompt",
  "greetingText",
  "voiceStyle",
  "language",
  "tone",
] as const;

const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

const PROHIBITED_PATTERN =
  /(Bearer\s+[A-Za-z0-9._-]+|WHRB\d{6}|sk-[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d ()-]{8,}\d)/i;

@Injectable()
export class ConversationConfigService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getOrgConfig(orgId: number, actor: Actor) {
    await this.ensureOrgAccess(actor, orgId);
    const config = await this.prisma.organizationConversationConfig.findUnique({
      where: { orgId },
    });
    return config ? this.toSafeConfig(config) : null;
  }

  async upsertOrgConfig(
    orgId: number,
    dto: UpsertConversationConfigDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    const data = this.normalizeDto(dto);
    const existing =
      await this.prisma.organizationConversationConfig.findUnique({
        where: { orgId },
      });
    const nextVersion = (existing?.version ?? 0) + 1;
    const isPublished = dto.publish ?? existing?.isPublished ?? false;
    const publishedAt = isPublished ? new Date() : existing?.publishedAt ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.organizationConversationConfig.upsert({
        where: { orgId },
        update: {
          ...data,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
        create: {
          orgId,
          ...SYSTEM_DEFAULT_CONFIG,
          ...SYSTEM_DEFAULT_POLICIES,
          ...data,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
      });
      if (saved.isPublished) {
        await this.recordPublicationRevision(tx, {
          orgId,
          scope: "organization",
          sourceType: "organization_config",
          sourceId: saved.id,
          version: saved.version,
          previousVersion: existing?.version ?? null,
          publishedByUserId: actor.userId,
          publishedAt: saved.publishedAt ?? new Date(),
          snapshot: this.configSnapshot(saved),
        });
      }

      const updatedOrg = await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { tenantVersion: true },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "conversation_config.organization_upserted",
          targetType: "organization",
          targetId: orgId,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            scope: "organization",
            isPublished: saved.isPublished,
            version: saved.version,
            tenantVersion: updatedOrg.tenantVersion,
            changedFields: Object.keys(data),
          } as any,
        },
        tx,
      );

      return saved;
    });

    return this.toSafeConfig(result);
  }

  async getRobotEffectiveConfig(robotId: number, actor: Actor) {
    const robot = await this.getRobotForActor(robotId, actor);
    return this.resolveForRobot(robot.id);
  }

  async upsertRobotConfig(
    robotId: number,
    dto: UpsertConversationConfigDto,
    actor: Actor,
    correlationId?: string,
  ) {
    const robot = await this.getRobotForActor(robotId, actor);
    await this.ensureActiveOrg(robot.orgId);
    const data = this.normalizeDto(dto);
    const existing = await this.prisma.robotConversationConfig.findUnique({
      where: { robotId },
    });
    const nextVersion = (existing?.version ?? 0) + 1;
    const isPublished = dto.publish ?? existing?.isPublished ?? false;
    const publishedAt = isPublished ? new Date() : existing?.publishedAt ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.robotConversationConfig.upsert({
        where: { robotId },
        update: {
          ...data,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
        create: {
          robotId,
          ...data,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
      });
      if (saved.isPublished) {
        await this.recordPublicationRevision(tx, {
          orgId: robot.orgId,
          robotId,
          scope: "robot",
          sourceType: "robot_config",
          sourceId: saved.id,
          version: saved.version,
          previousVersion: existing?.version ?? null,
          publishedByUserId: actor.userId,
          publishedAt: saved.publishedAt ?? new Date(),
          snapshot: this.configSnapshot(saved),
        });
      }

      const updatedOrg = await tx.organization.update({
        where: { id: robot.orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { tenantVersion: true },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "conversation_config.robot_upserted",
          targetType: "robot",
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            scope: "robot",
            isPublished: saved.isPublished,
            version: saved.version,
            tenantVersion: updatedOrg.tenantVersion,
            changedFields: Object.keys(data),
          } as any,
        },
        tx,
      );

      return saved;
    });

    return this.resolveForRobot(robot.id, result);
  }

  async listOrgContext(orgId: number, actor: Actor) {
    await this.ensureOrgAccess(actor, orgId);
    const rows = await this.prisma.organizationConversationContext.findMany({
      where: { orgId },
      orderBy: [{ contextType: "asc" }, { stableKey: "asc" }],
    });
    return rows.map((row) => this.toSafeContext(row));
  }

  async upsertOrgContext(
    orgId: number,
    dto: UpsertConversationContextDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    const data = {
      stableKey: this.safeRequired(dto.stableKey, "stableKey"),
      contextType: this.safeRequired(dto.contextType, "contextType"),
      title: this.safeRequired(dto.title, "title"),
      body: this.safeRequired(dto.body, "body"),
    };
    const existing =
      await this.prisma.organizationConversationContext.findUnique({
        where: { orgId_stableKey: { orgId, stableKey: data.stableKey } },
      });
    const nextVersion = (existing?.version ?? 0) + 1;
    const isPublished = dto.publish ?? existing?.isPublished ?? false;
    const publishedAt = isPublished ? new Date() : existing?.publishedAt ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.organizationConversationContext.upsert({
        where: { orgId_stableKey: { orgId, stableKey: data.stableKey } },
        update: {
          contextType: data.contextType,
          title: data.title,
          body: data.body,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
        create: {
          orgId,
          ...data,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
      });
      if (saved.isPublished) {
        await this.recordPublicationRevision(tx, {
          orgId,
          scope: "context",
          sourceType: "conversation_context",
          sourceId: saved.id,
          stableKey: saved.stableKey,
          version: saved.version,
          previousVersion: existing?.version ?? null,
          publishedByUserId: actor.userId,
          publishedAt: saved.publishedAt ?? new Date(),
          snapshot: this.contextSnapshot(saved),
        });
      }
      const updatedOrg = await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { tenantVersion: true },
      });
      await this.audit.recordCritical(
        {
          actor,
          action: "conversation_context.upserted",
          targetType: "organization_conversation_context",
          targetId: saved.id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            stableKey: saved.stableKey,
            contextType: saved.contextType,
            isPublished: saved.isPublished,
            version: saved.version,
            tenantVersion: updatedOrg.tenantVersion,
          } as any,
        },
        tx,
      );
      return saved;
    });

    return this.toSafeContext(result);
  }

  async listApprovedQa(orgId: number, actor: Actor) {
    await this.ensureOrgAccess(actor, orgId);
    const rows = await this.prisma.organizationApprovedQa.findMany({
      where: { orgId },
      orderBy: { stableKey: "asc" },
    });
    return rows.map((row) => this.toSafeQa(row));
  }

  async upsertApprovedQa(
    orgId: number,
    dto: UpsertApprovedQaDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    const data = {
      stableKey: this.safeRequired(dto.stableKey, "stableKey"),
      question: this.safeRequired(dto.question, "question"),
      answer: this.safeRequired(dto.answer, "answer"),
    };
    const existing = await this.prisma.organizationApprovedQa.findUnique({
      where: { orgId_stableKey: { orgId, stableKey: data.stableKey } },
    });
    const nextVersion = (existing?.version ?? 0) + 1;
    const isPublished = dto.publish ?? existing?.isPublished ?? false;
    const publishedAt = isPublished ? new Date() : existing?.publishedAt ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.organizationApprovedQa.upsert({
        where: { orgId_stableKey: { orgId, stableKey: data.stableKey } },
        update: {
          question: data.question,
          answer: data.answer,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
        create: {
          orgId,
          ...data,
          isPublished,
          publishedAt,
          version: nextVersion,
          createdByUserId: actor.userId,
        },
      });
      if (saved.isPublished) {
        await this.recordPublicationRevision(tx, {
          orgId,
          scope: "qa",
          sourceType: "approved_qa",
          sourceId: saved.id,
          stableKey: saved.stableKey,
          version: saved.version,
          previousVersion: existing?.version ?? null,
          publishedByUserId: actor.userId,
          publishedAt: saved.publishedAt ?? new Date(),
          snapshot: this.qaSnapshot(saved),
        });
      }
      const updatedOrg = await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { tenantVersion: true },
      });
      await this.audit.recordCritical(
        {
          actor,
          action: "conversation_qa.upserted",
          targetType: "organization_approved_qa",
          targetId: saved.id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            stableKey: saved.stableKey,
            isPublished: saved.isPublished,
            version: saved.version,
            tenantVersion: updatedOrg.tenantVersion,
          } as any,
        },
        tx,
      );
      return saved;
    });

    return this.toSafeQa(result);
  }

  async listPublicationRevisions(orgId: number, actor: Actor) {
    await this.ensureOrgAccess(actor, orgId);
    const rows = await this.prisma.conversationPublicationRevision.findMany({
      where: { orgId },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((row) => this.toSafeRevision(row));
  }

  async restorePublicationRevision(
    orgId: number,
    revisionId: number,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    const revision =
      await this.prisma.conversationPublicationRevision.findUnique({
        where: { id: revisionId },
      });
    if (!revision || revision.orgId !== orgId) {
      throw new NotFoundException("Conversation publication revision not found");
    }

    const restored = await this.prisma.$transaction(async (tx) => {
      const restoredRecord = await this.restoreRevisionRecord(
        tx,
        revision as RevisionRecord,
        actor,
      );
      const updatedOrg = await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { tenantVersion: true },
      });
      await this.audit.recordCritical(
        {
          actor,
          action: "conversation_publication.restored",
          targetType: "conversation_publication_revision",
          targetId: revision.id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            scope: revision.scope,
            sourceType: revision.sourceType,
            stableKey: revision.stableKey,
            restoredRevisionId: revision.id,
            restoredVersion: revision.version,
            newVersion: restoredRecord.version,
            tenantVersion: updatedOrg.tenantVersion,
          } as any,
        },
        tx,
      );
      return restoredRecord;
    });

    return {
      revision: this.toSafeRevision(revision as RevisionRecord),
      restored,
    };
  }

  async resolveForRobot(robotId: number, knownRobotConfig?: ConfigRecord) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: {
        id: true,
        orgId: true,
        org: {
          select: {
            id: true,
            name: true,
            conversationConfig: true,
            conversationContexts: {
              where: { isPublished: true },
              orderBy: [{ contextType: "asc" }, { stableKey: "asc" }],
            },
            approvedQas: {
              where: { isPublished: true },
              orderBy: { stableKey: "asc" },
            },
          },
        },
        conversationConfig: true,
      },
    });
    if (!robot) throw new NotFoundException("Robot not found");

    const orgConfig = robot.org.conversationConfig?.isPublished
      ? robot.org.conversationConfig
      : null;
    const robotConfig = (knownRobotConfig ?? robot.conversationConfig)?.isPublished
      ? knownRobotConfig ?? robot.conversationConfig
      : null;

    const effective = {
      ...SYSTEM_DEFAULT_CONFIG,
      ...(orgConfig ? this.pickConfigFields(orgConfig) : {}),
      ...(robotConfig ? this.pickConfigFields(robotConfig, true) : {}),
    };
    const policies = this.toEffectivePolicies({
      ...SYSTEM_DEFAULT_POLICIES,
      ...(orgConfig ? this.pickPolicyFields(orgConfig, true) : {}),
      ...(robotConfig ? this.pickPolicyFields(robotConfig, true) : {}),
    });

    return {
      schemaVersion: 1,
      source: robotConfig
        ? "robotOverride"
        : orgConfig
          ? "organizationDefault"
          : "systemDefault",
      orgId: robot.orgId,
      robotId: robot.id,
      version: {
        organization: orgConfig?.version ?? 0,
        robot: robotConfig?.version ?? 0,
        effective: `conversation-org-${robot.orgId}-v${orgConfig?.version ?? 0}-robot-${robot.id}-v${robotConfig?.version ?? 0}`,
      },
      publishedAt:
        robotConfig?.publishedAt?.toISOString() ??
        orgConfig?.publishedAt?.toISOString() ??
        null,
      approvedContext: this.toEffectiveContext(
        robot.org.conversationContexts ?? [],
        robot.org.approvedQas ?? [],
      ),
      policies,
      ...effective,
    };
  }

  private async restoreRevisionRecord(
    tx: Prisma.TransactionClient,
    revision: RevisionRecord,
    actor: Actor,
  ) {
    const snapshot = this.requireSnapshotObject(revision.snapshot);
    const sourceType = revision.sourceType as PublicationSource;
    const publishedAt = new Date();

    if (sourceType === "organization_config") {
      const existing = await tx.organizationConversationConfig.findUnique({
        where: { orgId: revision.orgId },
      });
      const version = (existing?.version ?? 0) + 1;
      const saved = await tx.organizationConversationConfig.upsert({
        where: { orgId: revision.orgId },
        update: {
          ...this.configRestoreData(snapshot),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
        create: {
          orgId: revision.orgId,
          ...SYSTEM_DEFAULT_CONFIG,
          ...SYSTEM_DEFAULT_POLICIES,
          ...this.configRestoreData(snapshot),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
      });
      await this.recordPublicationRevision(tx, {
        orgId: revision.orgId,
        scope: "organization",
        sourceType,
        sourceId: saved.id,
        version: saved.version,
        previousVersion: existing?.version ?? null,
        publishedByUserId: actor.userId,
        publishedAt: saved.publishedAt ?? publishedAt,
        restoredFromRevisionId: revision.id,
        snapshot: this.configSnapshot(saved),
      });
      return this.toSafeConfig(saved);
    }

    if (sourceType === "robot_config") {
      if (!revision.robotId) {
        throw new BadRequestException("Conversation publication revision is invalid");
      }
      const robot = await tx.robot.findUnique({
        where: { id: revision.robotId },
        select: { id: true, orgId: true },
      });
      if (!robot || robot.orgId !== revision.orgId) {
        throw new NotFoundException("Robot not found");
      }
      const existing = await tx.robotConversationConfig.findUnique({
        where: { robotId: revision.robotId },
      });
      const version = (existing?.version ?? 0) + 1;
      const saved = await tx.robotConversationConfig.upsert({
        where: { robotId: revision.robotId },
        update: {
          ...this.configRestoreData(snapshot),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
        create: {
          robotId: revision.robotId,
          ...this.configRestoreData(snapshot),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
      });
      await this.recordPublicationRevision(tx, {
        orgId: revision.orgId,
        robotId: revision.robotId,
        scope: "robot",
        sourceType,
        sourceId: saved.id,
        version: saved.version,
        previousVersion: existing?.version ?? null,
        publishedByUserId: actor.userId,
        publishedAt: saved.publishedAt ?? publishedAt,
        restoredFromRevisionId: revision.id,
        snapshot: this.configSnapshot(saved),
      });
      return this.toSafeConfig(saved);
    }

    if (sourceType === "conversation_context") {
      const stableKey = this.snapshotString(snapshot, "stableKey");
      const existing = await tx.organizationConversationContext.findUnique({
        where: { orgId_stableKey: { orgId: revision.orgId, stableKey } },
      });
      const version = (existing?.version ?? 0) + 1;
      const saved = await tx.organizationConversationContext.upsert({
        where: { orgId_stableKey: { orgId: revision.orgId, stableKey } },
        update: {
          contextType: this.snapshotString(snapshot, "contextType"),
          title: this.snapshotString(snapshot, "title"),
          body: this.snapshotString(snapshot, "body"),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
        create: {
          orgId: revision.orgId,
          stableKey,
          contextType: this.snapshotString(snapshot, "contextType"),
          title: this.snapshotString(snapshot, "title"),
          body: this.snapshotString(snapshot, "body"),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
      });
      await this.recordPublicationRevision(tx, {
        orgId: revision.orgId,
        scope: "context",
        sourceType,
        sourceId: saved.id,
        stableKey: saved.stableKey,
        version: saved.version,
        previousVersion: existing?.version ?? null,
        publishedByUserId: actor.userId,
        publishedAt: saved.publishedAt ?? publishedAt,
        restoredFromRevisionId: revision.id,
        snapshot: this.contextSnapshot(saved),
      });
      return this.toSafeContext(saved);
    }

    if (sourceType === "approved_qa") {
      const stableKey = this.snapshotString(snapshot, "stableKey");
      const existing = await tx.organizationApprovedQa.findUnique({
        where: { orgId_stableKey: { orgId: revision.orgId, stableKey } },
      });
      const version = (existing?.version ?? 0) + 1;
      const saved = await tx.organizationApprovedQa.upsert({
        where: { orgId_stableKey: { orgId: revision.orgId, stableKey } },
        update: {
          question: this.snapshotString(snapshot, "question"),
          answer: this.snapshotString(snapshot, "answer"),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
        create: {
          orgId: revision.orgId,
          stableKey,
          question: this.snapshotString(snapshot, "question"),
          answer: this.snapshotString(snapshot, "answer"),
          isPublished: true,
          publishedAt,
          version,
          createdByUserId: actor.userId,
        },
      });
      await this.recordPublicationRevision(tx, {
        orgId: revision.orgId,
        scope: "qa",
        sourceType,
        sourceId: saved.id,
        stableKey: saved.stableKey,
        version: saved.version,
        previousVersion: existing?.version ?? null,
        publishedByUserId: actor.userId,
        publishedAt: saved.publishedAt ?? publishedAt,
        restoredFromRevisionId: revision.id,
        snapshot: this.qaSnapshot(saved),
      });
      return this.toSafeQa(saved);
    }

    throw new BadRequestException("Conversation publication revision is invalid");
  }

  private async getRobotForActor(robotId: number, actor: Actor) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, orgId: true },
    });
    if (!robot) throw new NotFoundException("Robot not found");
    await this.ensureOrgAccess(actor, robot.orgId);
    return robot;
  }

  private async ensureOrgAccess(actor: Actor, orgId: number) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId || actor.orgId !== orgId) {
      throw new ForbiddenException("Cannot access other org");
    }
  }

  private async ensureActiveOrg(orgId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { isActive: true },
    });
    if (!org) throw new NotFoundException("Organization not found");
    if (!org.isActive) {
      throw new ForbiddenException("Organization is inactive");
    }
  }

  private async recordPublicationRevision(
    tx: Prisma.TransactionClient,
    input: {
      orgId: number;
      robotId?: number | null;
      scope: string;
      sourceType: PublicationSource;
      sourceId?: number | null;
      stableKey?: string | null;
      version: number;
      previousVersion?: number | null;
      snapshot: Prisma.InputJsonObject;
      publishedByUserId?: number | null;
      publishedAt: Date;
      restoredFromRevisionId?: number | null;
    },
  ) {
    return tx.conversationPublicationRevision.create({
      data: {
        orgId: input.orgId,
        robotId: input.robotId ?? null,
        scope: input.scope,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        stableKey: input.stableKey ?? null,
        version: input.version,
        previousVersion: input.previousVersion ?? null,
        snapshot: input.snapshot,
        publishedByUserId: input.publishedByUserId ?? null,
        publishedAt: input.publishedAt,
        restoredFromRevisionId: input.restoredFromRevisionId ?? null,
      },
    });
  }

  private configSnapshot(record: ConfigRecord): Prisma.InputJsonObject {
    return {
      ...this.pickConfigFields(record),
      ...this.pickPolicyFields(record),
    } as Prisma.InputJsonObject;
  }

  private contextSnapshot(record: ContextRecord): Prisma.InputJsonObject {
    return {
      stableKey: record.stableKey,
      contextType: record.contextType,
      title: record.title,
      body: record.body,
    };
  }

  private qaSnapshot(record: QaRecord): Prisma.InputJsonObject {
    return {
      stableKey: record.stableKey,
      question: record.question,
      answer: record.answer,
    };
  }

  private configRestoreData(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      personaName: this.optionalSnapshotString(snapshot, "personaName"),
      personaPrompt: this.optionalSnapshotString(snapshot, "personaPrompt"),
      greetingText: this.optionalSnapshotString(snapshot, "greetingText"),
      voiceStyle: this.optionalSnapshotString(snapshot, "voiceStyle"),
      language: this.optionalSnapshotString(snapshot, "language"),
      tone: this.optionalSnapshotString(snapshot, "tone"),
      defaultLanguage: this.optionalSnapshotString(snapshot, "defaultLanguage"),
      supportedLanguages:
        this.optionalJson(snapshot.supportedLanguages) ?? Prisma.DbNull,
      speechSpeed: this.optionalSnapshotNumber(snapshot, "speechSpeed"),
      sessionMaxSeconds: this.optionalSnapshotInteger(snapshot, "sessionMaxSeconds"),
      sessionIdleTimeoutSeconds: this.optionalSnapshotInteger(
        snapshot,
        "sessionIdleTimeoutSeconds",
      ),
      cooldownSeconds: this.optionalSnapshotInteger(snapshot, "cooldownSeconds"),
      dailySessionLimit: this.optionalSnapshotInteger(snapshot, "dailySessionLimit"),
    };
  }

  private requireSnapshotObject(snapshot: Prisma.JsonValue) {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot)
    ) {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return snapshot as Record<string, unknown>;
  }

  private snapshotString(snapshot: Record<string, unknown>, field: string) {
    const value = snapshot[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return value;
  }

  private optionalSnapshotString(
    snapshot: Record<string, unknown>,
    field: string,
  ) {
    const value = snapshot[field];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return value;
  }

  private optionalSnapshotNumber(
    snapshot: Record<string, unknown>,
    field: string,
  ) {
    const value = snapshot[field];
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return value;
  }

  private optionalSnapshotInteger(
    snapshot: Record<string, unknown>,
    field: string,
  ) {
    const value = this.optionalSnapshotNumber(snapshot, field);
    if (value === null) return null;
    if (!Number.isInteger(value)) {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return value;
  }

  private optionalJson(value: unknown) {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return value.filter(
      (language): language is string => typeof language === "string",
    );
  }

  private normalizeDto(dto: UpsertConversationConfigDto) {
    const data: Record<string, unknown> = {};
    for (const field of CONFIG_FIELDS) {
      if (!(field in dto)) continue;
      const value = dto[field];
      if (value === null || value === undefined) {
        data[field] = null;
        continue;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        data[field] = null;
        continue;
      }
      if (PROHIBITED_PATTERN.test(trimmed)) {
        throw new BadRequestException("Conversation settings contain blocked data");
      }
      data[field] = trimmed;
    }

    if ("defaultLanguage" in dto) {
      data.defaultLanguage =
        dto.defaultLanguage === null || dto.defaultLanguage === undefined
          ? null
          : this.safeLanguage(dto.defaultLanguage);
    }
    if ("supportedLanguages" in dto) {
      data.supportedLanguages =
        dto.supportedLanguages === null || dto.supportedLanguages === undefined
          ? null
          : this.safeLanguageList(dto.supportedLanguages);
    }
    this.assignNumberPolicy(data, dto, "speechSpeed", 0.5, 2);
    this.assignNumberPolicy(data, dto, "sessionMaxSeconds", 60, 3600, true);
    this.assignNumberPolicy(
      data,
      dto,
      "sessionIdleTimeoutSeconds",
      15,
      900,
      true,
    );
    this.assignNumberPolicy(data, dto, "cooldownSeconds", 0, 600, true);
    this.assignNumberPolicy(data, dto, "dailySessionLimit", 1, 100, true);
    return data;
  }

  private assignNumberPolicy(
    data: Record<string, unknown>,
    dto: UpsertConversationConfigDto,
    field:
      | "speechSpeed"
      | "sessionMaxSeconds"
      | "sessionIdleTimeoutSeconds"
      | "cooldownSeconds"
      | "dailySessionLimit",
    min: number,
    max: number,
    integer = false,
  ) {
    if (!(field in dto)) return;
    const value = dto[field];
    if (value === null || value === undefined) {
      data[field] = null;
      return;
    }
    if (
      typeof value !== "number" ||
      Number.isNaN(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      throw new BadRequestException("Conversation policy value is out of range");
    }
    data[field] = value;
  }

  private safeLanguage(value: string) {
    const trimmed = value.trim();
    if (!LANGUAGE_PATTERN.test(trimmed)) {
      throw new BadRequestException("Conversation language is invalid");
    }
    return trimmed;
  }

  private safeLanguageList(value: string[]) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
      throw new BadRequestException("Conversation languages are invalid");
    }
    const languages = value.map((language) => this.safeLanguage(language));
    return Array.from(new Set(languages));
  }

  private safeRequired(value: string, field: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`Invalid ${field}`);
    }
    if (PROHIBITED_PATTERN.test(trimmed)) {
      throw new BadRequestException("Conversation content contains blocked data");
    }
    return trimmed;
  }

  private pickConfigFields(record: ConfigRecord, skipNull = false) {
    const picked: Record<string, string | null> = {};
    for (const field of CONFIG_FIELDS) {
      const value = record[field];
      if (skipNull && value === null) continue;
      picked[field] = value;
    }
    return picked;
  }

  private pickPolicyFields(record: ConfigRecord, skipNull = false) {
    const picked: Record<string, unknown> = {};
    for (const field of [
      "defaultLanguage",
      "supportedLanguages",
      "speechSpeed",
      "sessionMaxSeconds",
      "sessionIdleTimeoutSeconds",
      "cooldownSeconds",
      "dailySessionLimit",
    ] as const) {
      const value = record[field];
      if (skipNull && (value === null || value === undefined)) continue;
      picked[field] = value;
    }
    return picked;
  }

  private toLanguageArray(value: unknown) {
    if (!Array.isArray(value)) return SYSTEM_DEFAULT_POLICIES.supportedLanguages;
    return value.filter(
      (language): language is string => typeof language === "string",
    );
  }

  private toEffectivePolicies(value: typeof SYSTEM_DEFAULT_POLICIES) {
    return {
      schemaVersion: 1,
      language: {
        default: value.defaultLanguage,
        supported: this.toLanguageArray(value.supportedLanguages),
      },
      speech: {
        speed: value.speechSpeed,
      },
      session: {
        maxSeconds: value.sessionMaxSeconds,
        idleTimeoutSeconds: value.sessionIdleTimeoutSeconds,
        dailyLimit: value.dailySessionLimit,
      },
      cooldown: {
        seconds: value.cooldownSeconds,
      },
    };
  }

  private toSafeConfig(config: ConfigRecord) {
    return {
      id: config.id,
      ...this.pickConfigFields(config),
      ...this.pickPolicyFields(config),
      isPublished: config.isPublished,
      version: config.version,
      publishedAt: config.publishedAt?.toISOString() ?? null,
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  private toSafeContext(row: ContextRecord) {
    return {
      id: row.id,
      stableKey: row.stableKey,
      contextType: row.contextType,
      title: row.title,
      body: row.body,
      isPublished: row.isPublished,
      version: row.version,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toSafeQa(row: QaRecord) {
    return {
      id: row.id,
      stableKey: row.stableKey,
      question: row.question,
      answer: row.answer,
      isPublished: row.isPublished,
      version: row.version,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toSafeRevision(row: RevisionRecord) {
    return {
      id: row.id,
      orgId: row.orgId,
      robotId: row.robotId,
      scope: row.scope,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      stableKey: row.stableKey,
      version: row.version,
      previousVersion: row.previousVersion,
      publishedByUserId: row.publishedByUserId,
      publishedAt: row.publishedAt.toISOString(),
      restoredFromRevisionId: row.restoredFromRevisionId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toEffectiveContext(contexts: ContextRecord[], qas: QaRecord[]) {
    const contextVersion = contexts.reduce(
      (sum, row) => sum + row.version,
      0,
    );
    const qaVersion = qas.reduce((sum, row) => sum + row.version, 0);
    return {
      schemaVersion: 1,
      version: {
        context: contextVersion,
        qa: qaVersion,
        effective: `approved-context-v${contextVersion}-qa-v${qaVersion}`,
      },
      contexts: contexts.map((row) => ({
        stableKey: row.stableKey,
        contextType: row.contextType,
        title: row.title,
        body: row.body,
        version: row.version,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      })),
      approvedQa: qas.map((row) => ({
        stableKey: row.stableKey,
        question: row.question,
        answer: row.answer,
        version: row.version,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      })),
    };
  }
}
