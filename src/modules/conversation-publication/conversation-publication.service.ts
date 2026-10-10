import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuditActor } from "../audit/audit.types";

type Tx = Prisma.TransactionClient | PrismaService | PrismaClient;

type RevisionInput = {
  orgId: number;
  robotId?: number | null;
  scope: string;
  sourceType:
    | "organization_persona"
    | "robot_persona"
    | "conversation_context"
    | "approved_qa";
  sourceId?: number | null;
  stableKey?: string | null;
  version: number;
  previousVersion?: number | null;
  snapshot: Prisma.InputJsonValue;
  actor: AuditActor;
  restoredFromRevisionId?: number | null;
};

@Injectable()
export class ConversationPublicationService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async recordRevision(tx: Tx, input: RevisionInput) {
    return (tx as any).conversationPublicationRevision.create({
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
        publishedByUserId: input.actor.userId,
        publishedAt: new Date(),
        restoredFromRevisionId: input.restoredFromRevisionId ?? null,
      },
    });
  }

  async list(orgId: number, actor: AuditActor) {
    await this.assertOrgAccess(orgId, actor);
    const rows = await (this.prisma as any).conversationPublicationRevision.findMany({
      where: { orgId },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((row: any) => this.toSafeRevision(row));
  }

  async restore(orgId: number, revisionId: number, actor: AuditActor) {
    await this.assertOrgAccess(orgId, actor);
    await this.assertActiveOrg(orgId);
    const revision =
      await (this.prisma as any).conversationPublicationRevision.findUnique({
        where: { id: revisionId },
      });
    if (!revision || revision.orgId !== orgId) {
      throw new NotFoundException("Conversation publication revision not found");
    }

    const restored = await this.prisma.$transaction(async (tx) => {
      const result = await this.restoreRevisionRecord(tx, revision, actor);
      await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
      });
      await this.audit.recordCritical(
        {
          actor,
          action: "conversation_publication.restored",
          targetType: "conversation_publication_revision",
          targetId: revision.id,
          targetOrgId: orgId,
          metadata: {
            sourceType: revision.sourceType,
            sourceId: revision.sourceId,
            robotId: revision.robotId,
            restoredRevisionId: revision.id,
            restoredVersion: revision.version,
            newVersion: result.version,
          },
        },
        tx,
      );
      return result;
    });

    return {
      revision: this.toSafeRevision(revision),
      restored,
    };
  }

  private async restoreRevisionRecord(
    tx: Prisma.TransactionClient,
    revision: {
      id: number;
      orgId: number;
      robotId: number | null;
      sourceType: string;
      sourceId: number | null;
      snapshot: Prisma.JsonValue;
    },
    actor: AuditActor,
  ) {
    const snapshot = this.expectSnapshot(revision.snapshot);

    if (revision.sourceType === "organization_persona") {
      const existing = await tx.organizationPersonaConfig.findUnique({
        where: { orgId: revision.orgId },
      });
      const version = (existing?.version ?? 0) + 1;
      const restored = await tx.organizationPersonaConfig.upsert({
        where: { orgId: revision.orgId },
        create: {
          orgId: revision.orgId,
          ...this.personaSnapshot(snapshot),
          version,
          isPublished: true,
        },
        update: {
          ...this.personaSnapshot(snapshot),
          version,
          isPublished: true,
        },
      });
      await this.recordRevision(tx, {
        orgId: revision.orgId,
        scope: "organization",
        sourceType: "organization_persona",
        sourceId: restored.id,
        version,
        previousVersion: existing?.version ?? null,
        snapshot: this.safeJson(this.personaSnapshot(restored as any)),
        actor,
        restoredFromRevisionId: revision.id,
      });
      return restored;
    }

    if (revision.sourceType === "robot_persona") {
      if (!revision.robotId) {
        throw new BadRequestException("Conversation publication revision is invalid");
      }
      const existing = await tx.robotPersonaConfig.findUnique({
        where: { robotId: revision.robotId },
      });
      const version = (existing?.version ?? 0) + 1;
      const restored = await tx.robotPersonaConfig.upsert({
        where: { robotId: revision.robotId },
        create: {
          orgId: revision.orgId,
          robotId: revision.robotId,
          ...this.robotPersonaSnapshot(snapshot),
          version,
          isPublished: true,
        },
        update: {
          ...this.robotPersonaSnapshot(snapshot),
          version,
          isPublished: true,
        },
      });
      await this.recordRevision(tx, {
        orgId: revision.orgId,
        robotId: revision.robotId,
        scope: "robot",
        sourceType: "robot_persona",
        sourceId: restored.id,
        version,
        previousVersion: existing?.version ?? null,
        snapshot: this.safeJson(this.robotPersonaSnapshot(restored as any)),
        actor,
        restoredFromRevisionId: revision.id,
      });
      return restored;
    }

    if (revision.sourceType === "conversation_context") {
      const existing = await tx.organizationConversationContext.findUnique({
        where: { orgId: revision.orgId },
      });
      const version = (existing?.version ?? 0) + 1;
      const restored = await tx.organizationConversationContext.upsert({
        where: { orgId: revision.orgId },
        create: {
          orgId: revision.orgId,
          ...this.contextSnapshot(snapshot),
          version,
          isPublished: true,
        },
        update: {
          ...this.contextSnapshot(snapshot),
          version,
          isPublished: true,
        },
      });
      await this.recordRevision(tx, {
        orgId: revision.orgId,
        scope: "organization",
        sourceType: "conversation_context",
        sourceId: restored.id,
        version,
        previousVersion: existing?.version ?? null,
        snapshot: this.safeJson(this.contextSnapshot(restored as any)),
        actor,
        restoredFromRevisionId: revision.id,
      });
      return restored;
    }

    if (revision.sourceType === "approved_qa") {
      const existing = revision.sourceId
        ? await tx.organizationApprovedQa.findUnique({
            where: { id: revision.sourceId },
          })
        : null;
      const version = (existing?.version ?? 0) + 1;
      const snapshotData = this.qaSnapshot(snapshot);
      const restored = existing
        ? await tx.organizationApprovedQa.update({
            where: { id: existing.id },
            data: { ...snapshotData, version, isPublished: true },
          })
        : await tx.organizationApprovedQa.create({
            data: {
              orgId: revision.orgId,
              ...snapshotData,
              version,
              isPublished: true,
            },
          });
      await this.recordRevision(tx, {
        orgId: revision.orgId,
        scope: "organization",
        sourceType: "approved_qa",
        sourceId: restored.id,
        stableKey: restored.category,
        version,
        previousVersion: existing?.version ?? null,
        snapshot: this.safeJson(this.qaSnapshot(restored as any)),
        actor,
        restoredFromRevisionId: revision.id,
      });
      return restored;
    }

    throw new BadRequestException("Conversation publication revision is invalid");
  }

  private async assertOrgAccess(orgId: number, actor: AuditActor) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId || actor.orgId !== orgId) {
      throw new ForbiddenException("Tenant access forbidden");
    }
  }

  private async assertActiveOrg(orgId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { isActive: true },
    });
    if (!org) throw new NotFoundException("Organization not found");
    if (!org.isActive) throw new ForbiddenException("Organization is inactive");
  }

  private expectSnapshot(value: Prisma.JsonValue) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Conversation publication revision is invalid");
    }
    return value as Record<string, unknown>;
  }

  private personaSnapshot(value: Record<string, unknown>) {
    return {
      personaName: String(value.personaName ?? "WhizRobot Assistant"),
      personaPrompt: typeof value.personaPrompt === "string" ? value.personaPrompt : null,
      greetingText: String(value.greetingText ?? "Hello! Welcome to our organization."),
      speechGreeting: String(value.speechGreeting ?? value.greetingText ?? "Hello! Welcome to our organization."),
      voiceStyle: String(value.voiceStyle ?? "standard"),
      language: String(value.language ?? "en-US"),
      tone: String(value.tone ?? "friendly"),
      speechSpeed: Number(value.speechSpeed ?? 1),
      sessionMaxSeconds: Number(value.sessionMaxSeconds ?? 300),
      sessionIdleTimeoutSeconds: Number(value.sessionIdleTimeoutSeconds ?? 60),
      cooldownSeconds: Number(value.cooldownSeconds ?? 5),
      dailySessionLimit: Number(value.dailySessionLimit ?? 1000),
      supportedLanguages: String(value.supportedLanguages ?? "en-US"),
    };
  }

  private robotPersonaSnapshot(value: Record<string, unknown>) {
    const maybeNumber = (item: unknown) =>
      typeof item === "number" && Number.isFinite(item) ? item : null;
    return {
      personaName: typeof value.personaName === "string" ? value.personaName : null,
      personaPrompt: typeof value.personaPrompt === "string" ? value.personaPrompt : null,
      greetingText: typeof value.greetingText === "string" ? value.greetingText : null,
      speechGreeting: typeof value.speechGreeting === "string" ? value.speechGreeting : null,
      voiceStyle: typeof value.voiceStyle === "string" ? value.voiceStyle : null,
      language: typeof value.language === "string" ? value.language : null,
      tone: typeof value.tone === "string" ? value.tone : null,
      speechSpeed: maybeNumber(value.speechSpeed),
      sessionMaxSeconds: maybeNumber(value.sessionMaxSeconds),
      sessionIdleTimeoutSeconds: maybeNumber(value.sessionIdleTimeoutSeconds),
      cooldownSeconds: maybeNumber(value.cooldownSeconds),
      dailySessionLimit: maybeNumber(value.dailySessionLimit),
      supportedLanguages: typeof value.supportedLanguages === "string" ? value.supportedLanguages : null,
    };
  }

  private contextSnapshot(value: Record<string, unknown>) {
    return {
      companyOverview: typeof value.companyOverview === "string" ? value.companyOverview : null,
      operatingHours: typeof value.operatingHours === "string" ? value.operatingHours : null,
      locationDetails: typeof value.locationDetails === "string" ? value.locationDetails : null,
      visitorGuidelines: typeof value.visitorGuidelines === "string" ? value.visitorGuidelines : null,
      eventsSummary: typeof value.eventsSummary === "string" ? value.eventsSummary : null,
    };
  }

  private qaSnapshot(value: Record<string, unknown>) {
    return {
      question: String(value.question ?? ""),
      answer: String(value.answer ?? ""),
      category: typeof value.category === "string" ? value.category : null,
      sortOrder: Number(value.sortOrder ?? 0),
    };
  }

  private safeJson(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value));
  }

  private toSafeRevision(row: {
    id: number;
    orgId: number;
    robotId: number | null;
    scope: string;
    sourceType: string;
    sourceId: number | null;
    stableKey: string | null;
    version: number;
    previousVersion: number | null;
    publishedByUserId: number | null;
    publishedAt: Date;
    restoredFromRevisionId: number | null;
    createdAt: Date;
  }) {
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
}
