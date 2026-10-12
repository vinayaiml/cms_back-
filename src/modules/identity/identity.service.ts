import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import {
  decryptProtectedJson,
  encryptProtectedJson,
  protectedJsonFingerprint,
} from "../../common/security/protected-json";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  CreateIdentityEmbeddingDto,
  DeleteIdentityEmbeddingDto,
  RobotIdentityEmbeddingDto,
  RobotIdentityEnrollmentDto,
  RobotIdentityFeedbackDto,
  RobotIdentityTemplateDto,
  RecognitionModelUploadDto,
  RevokeIdentityConsentDto,
  UpdateIdentityEmbeddingDto,
} from "./identity.dto";

type Actor = {
  userId: number | null;
  orgId: number | null;
  isSuperAdmin: boolean;
};

type IdentityRecord = {
  id: number;
  orgId: number;
  subjectRef: string;
  consentGranted: boolean;
  consentSource: string;
  consentPolicyVersion: string;
  consentGrantedAt: Date;
  embeddingFingerprint: string | null;
  embeddingSchemaVersion: number;
  status: string;
  retentionExpiresAt: Date | null;
  deletedAt: Date | null;
  deletionReason: string | null;
  createdByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type RobotIdentityRoute =
  | "enrollment"
  | "template"
  | "feedback";

const PROHIBITED_PATTERN =
  /(Bearer\s+[A-Za-z0-9._-]+|WHRB\d{6}|sk-[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d ()-]{8,}\d)/i;

const ALLOWED_RECOGNITION_MODELS = new Set([
  "face-std-sface-int8-v1",
  "face-pro-sface-fp16-v1",
  "identity-local-v1",
]);

@Injectable()
export class IdentityService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Optional()
    private config?: ConfigService,
  ) {}

  async list(orgId: number, actor: Actor) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    const rows = await this.prisma.identityEmbeddingRecord.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toSafeRecord(row));
  }

  async getAuthorizedGalleryForOrg(orgId: number) {
    const rows = await this.prisma.identityEmbeddingRecord.findMany({
      where: {
        orgId,
        consentGranted: true,
        status: "ACTIVE",
        deletedAt: null,
        OR: [
          { retentionExpiresAt: null },
          { retentionExpiresAt: { gt: new Date() } },
        ],
        embeddingFingerprint: { not: null },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        orgId: true,
        subjectRef: true,
        consentPolicyVersion: true,
        consentGrantedAt: true,
        embeddingFingerprint: true,
        embeddingSchemaVersion: true,
        updatedAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      subjectRef: this.safeSubjectRef(row.subjectRef),
      consent: {
        granted: true,
        policyVersion: row.consentPolicyVersion,
        grantedAt: row.consentGrantedAt.toISOString(),
      },
      embedding: {
        schemaVersion: row.embeddingSchemaVersion,
        fingerprint: row.embeddingFingerprint,
      },
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async enrollFromRobot(
    orgId: number,
    robotId: number,
    dto: RobotIdentityEnrollmentDto,
    idempotencyKey?: string,
    correlationId?: string,
  ) {
    return this.withRobotIdempotency(
      orgId,
      robotId,
      "enrollment",
      idempotencyKey,
      async () => {
        await this.ensureActiveOrg(orgId);
        await this.ensureRobotOrg(robotId, orgId);
        this.validateSubjectRef(dto.subjectRef);
        this.validateConsent({
          subjectRef: dto.subjectRef,
          consent: dto.consent,
          embeddingMetadata: {},
        });
        await this.assertCatalogueModels([
          dto.embedding?.modelId,
          ...(dto.templates ?? []).map((template) => template.modelId),
        ]);
        const embeddingMetadata = this.normalizeRobotEmbedding(dto);

        const saved = await this.create(
          orgId,
          {
            subjectRef: dto.subjectRef,
            consent: dto.consent,
            embeddingMetadata,
          },
          { userId: null, orgId, isSuperAdmin: false },
          correlationId ?? idempotencyKey,
        );
        await this.storeEnrollmentTemplates(
          orgId,
          robotId,
          saved.id,
          dto.templates ?? [dto.embedding],
          idempotencyKey,
        );
        return saved;
      },
    );
  }

  async getRobotGallery(orgId: number, robotId: number, sinceVersion?: string) {
    await this.ensureActiveOrg(orgId);
    await this.ensureRobotOrg(robotId, orgId);

    const now = new Date();
    const rows = await this.prisma.identityEmbeddingRecord.findMany({
      where: { orgId },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        orgId: true,
        subjectRef: true,
        consentGranted: true,
        status: true,
        embeddingCiphertext: true,
        embeddingFingerprint: true,
        retentionExpiresAt: true,
        deletedAt: true,
        updatedAt: true,
      },
    });

    const upserts: any[] = [];
    const deletions = [];
    const activeIdentityIds = [];
    // Same inputs as getAuthorizedGallerySummaryForOrg so manifest and gallery versions always match.
    const versionUpserts: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const expired =
        row.retentionExpiresAt && row.retentionExpiresAt.getTime() <= now.getTime();
      if (
        !row.consentGranted ||
        row.status !== "ACTIVE" ||
        row.deletedAt ||
        expired ||
        !row.embeddingCiphertext ||
        !row.embeddingFingerprint
      ) {
        deletions.push({
          id: row.id,
          subjectRef: this.safeSubjectRef(row.subjectRef),
          deletedAt: (row.deletedAt ?? row.updatedAt).toISOString(),
        });
        continue;
      }

      const metadata = this.decryptEmbeddingMetadata(row.embeddingCiphertext);
      activeIdentityIds.push(row.id);
      versionUpserts.push({ id: row.id, modelId: row.embeddingFingerprint, updatedAt: row.updatedAt.toISOString() });
      upserts.push({
        id: row.id,
        subjectRef: this.safeSubjectRef(row.subjectRef),
        displayName:
          typeof metadata.displayName === "string" ? metadata.displayName : null,
        modelId: metadata.modelId,
        dimension: metadata.dimension,
        vector: metadata.vector,
        templates: [
          {
            modelId: metadata.modelId,
            dimension: metadata.dimension,
            vector: metadata.vector,
            qualityScore: 1,
          },
        ],
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    const templates = activeIdentityIds.length
      ? await (this.prisma as any).identityTemplate.findMany({
          where: { identityId: { in: activeIdentityIds } },
          orderBy: [{ identityId: "asc" }, { modelId: "asc" }, { qualityScore: "desc" }],
        })
      : [];
    const byIdentity = new Map(upserts.map((item) => [item.id, item]));
    for (const template of templates) {
      const owner = byIdentity.get(template.identityId);
      if (!owner) continue;
      const payload = decryptProtectedJson(template.vectorCiphertext) as Record<string, unknown>;
      owner.templates.push({
        modelId: template.modelId,
        dimension: typeof payload.dimension === "number" ? payload.dimension : owner.dimension,
        vector: typeof payload.vector === "string" ? payload.vector : "",
        qualityScore: template.qualityScore,
      });
    }

    const galleryVersion = this.computeGalleryVersion(orgId, versionUpserts, deletions, templates);
    if (sinceVersion && sinceVersion === galleryVersion) {
      return { version: galleryVersion, upserts: [], deletions: [], notModified: true };
    }
    return { version: galleryVersion, upserts, deletions, notModified: false };
  }

  async getRobotGallerySummary(orgId: number, robotId: number) {
    await this.ensureActiveOrg(orgId);
    await this.ensureRobotOrg(robotId, orgId);
    return this.getAuthorizedGallerySummaryForOrg(orgId);
  }

  async getAuthorizedGallerySummaryForOrg(orgId: number) {
    const rows = await this.prisma.identityEmbeddingRecord.findMany({
      where: { orgId },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        subjectRef: true,
        consentGranted: true,
        status: true,
        embeddingFingerprint: true,
        retentionExpiresAt: true,
        deletedAt: true,
        updatedAt: true,
      },
    });
    const now = Date.now();
    const activeIds = rows
      .filter(
        (row) =>
          row.consentGranted &&
          row.status === "ACTIVE" &&
          !row.deletedAt &&
          (!row.retentionExpiresAt || row.retentionExpiresAt.getTime() > now) &&
          row.embeddingFingerprint,
      )
      .map((row) => row.id);
    const templates = activeIds.length
      ? await (this.prisma as any).identityTemplate.findMany({
          where: { identityId: { in: activeIds } },
          select: {
            identityId: true,
            modelId: true,
            vectorFingerprint: true,
            qualityScore: true,
            createdAt: true,
          },
          orderBy: [{ identityId: "asc" }, { modelId: "asc" }, { qualityScore: "desc" }],
        })
      : [];
    const upserts = rows
      .filter((row) => activeIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        modelId: row.embeddingFingerprint,
        updatedAt: row.updatedAt.toISOString(),
      }));
    const deletions = rows
      .filter((row) => !activeIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        deletedAt: (row.deletedAt ?? row.updatedAt).toISOString(),
      }));
    return {
      version: this.computeGalleryVersion(orgId, upserts, deletions, templates),
      count: activeIds.length,
    };
  }

  async addRobotTemplate(
    orgId: number,
    robotId: number,
    identityId: number,
    dto: RobotIdentityTemplateDto,
    idempotencyKey?: string,
  ) {
    return this.withRobotIdempotency(
      orgId,
      robotId,
      "template",
      idempotencyKey,
      async () => {
    await this.ensureActiveOrg(orgId);
    await this.ensureRobotOrg(robotId, orgId);
    const identity = await this.prisma.identityEmbeddingRecord.findUnique({
      where: { id: identityId },
      select: {
        id: true,
        orgId: true,
        status: true,
        consentGranted: true,
        deletedAt: true,
        retentionExpiresAt: true,
      },
    });
    if (!identity || identity.orgId !== orgId) {
      throw new NotFoundException("Identity record not found");
    }
    if (
      !identity.consentGranted ||
      identity.status !== "ACTIVE" ||
      identity.deletedAt ||
      (identity.retentionExpiresAt && identity.retentionExpiresAt.getTime() <= Date.now())
    ) {
      throw new ForbiddenException("Identity record is not eligible for template backfill");
    }
    this.assertApprovedModel(dto.modelId);
    await this.assertCatalogueModels([dto.modelId]);
    this.assertVector(dto.vector, dto.dimension);
    const threshold = await this.thresholdForOrg(orgId, dto.modelId);
    if (dto.score < threshold.accept || dto.margin < threshold.margin || dto.votes < threshold.votes) {
      throw new BadRequestException("Identity template confidence is below threshold");
    }

    const payload = {
      modelId: dto.modelId,
      dimension: dto.dimension,
      vector: dto.vector,
      sourceRobotId: robotId,
      idempotencyKey: idempotencyKey ?? null,
    };
    const row = await (this.prisma as any).identityTemplate.create({
      data: {
        identityId,
        modelId: dto.modelId,
        vectorCiphertext: encryptProtectedJson(payload),
        vectorFingerprint: protectedJsonFingerprint(payload),
        qualityScore: dto.qualityScore,
        sourceRobotId: robotId,
      },
    });

    const templates = await (this.prisma as any).identityTemplate.findMany({
      where: { identityId, modelId: dto.modelId },
      orderBy: [{ qualityScore: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const excess = templates.length - 10;
    if (excess > 0) {
      await (this.prisma as any).identityTemplate.deleteMany({
        where: { id: { in: templates.slice(0, excess).map((item: { id: number }) => item.id) } },
      });
    }

    await this.audit.recordCritical({
      actor: { userId: null, orgId, isSuperAdmin: false },
      action: "identity_template.created",
      targetType: "identity_embedding",
      targetId: identityId,
      targetOrgId: orgId,
      correlationId: idempotencyKey,
      metadata: {
        modelId: dto.modelId,
        qualityScore: dto.qualityScore,
        sourceRobotId: robotId,
      } as any,
    });

    return {
      id: row.id,
      identityId,
      modelId: dto.modelId,
      qualityScore: dto.qualityScore,
      cappedAt: 10,
    };
      },
    );
  }

  async recordRecognitionFeedback(
    orgId: number,
    robotId: number,
    dto: RobotIdentityFeedbackDto,
    idempotencyKey?: string,
  ) {
    return this.withRobotIdempotency(
      orgId,
      robotId,
      "feedback",
      idempotencyKey,
      async () => {
    await this.ensureActiveOrg(orgId);
    await this.ensureRobotOrg(robotId, orgId);
    this.assertApprovedModel(dto.modelId);
    await this.assertCatalogueModels([dto.modelId]);
    if (dto.identityId) {
      const identity = await this.prisma.identityEmbeddingRecord.findUnique({
        where: { id: dto.identityId },
        select: { orgId: true },
      });
      if (!identity || identity.orgId !== orgId) {
        throw new NotFoundException("Identity record not found");
      }
    }
    const row = await (this.prisma as any).identityRecognitionFeedback.create({
      data: {
        identityId: dto.identityId ?? null,
        modelId: dto.modelId,
        orgId,
        robotId,
        score: dto.score,
        margin: dto.margin,
        votes: dto.votes,
        outcome: dto.outcome,
      },
    });

    return {
      id: row.id,
      stored: true,
      needsReregistration: dto.identityId
        ? await this.needsReregistration(dto.identityId)
        : false,
      idempotencyKey: idempotencyKey ?? null,
    };
      },
    );
  }

  async getRecognitionModelForRobot(
    orgId: number,
    robotId: number,
    modelId: string,
  ) {
    await this.ensureActiveOrg(orgId);
    const robot = await this.ensureRobotOrg(robotId, orgId);
    const model = await (this.prisma as any).recognitionModel.findUnique({
      where: { modelId },
    });
    if (!model || model.status !== "ACTIVE" || !model.fileBytes) {
      throw new NotFoundException("Recognition model not found");
    }
    const hardware = this.robotHardware(robot);
    // Same rule as resolveRecognitionPolicy: the standard model is every robot's fallback;
    // only pro models require the reported hardware minimums.
    if (
      model.tier !== "standard" &&
      (hardware.ramMb < model.minRamMb || hardware.androidApi < model.minAndroidApi)
    ) {
      throw new ForbiddenException("Recognition model is not authorized for this robot");
    }
    return {
      modelId: model.modelId,
      tier: model.tier,
      version: model.version,
      fileId: model.fileId,
      sha256: model.sha256,
      inputSize: model.inputSize,
      dimension: model.dimension,
      minRamMb: model.minRamMb,
      minAndroidApi: model.minAndroidApi,
      download: {
        url: `/api/v1/robot/identity/models/${encodeURIComponent(model.modelId)}/download?token=${this.signModelDownload(orgId, robotId, model.modelId)}`,
        expiresInSeconds: 300,
      },
    };
  }

  verifyModelDownloadToken(
    orgId: number,
    robotId: number,
    modelId: string,
    token: string,
  ) {
    try {
      const decoded = Buffer.from(token, "base64url").toString("utf8");
      const parts = decoded.split(".");
      if (parts.length < 5) return false;
      const signature = parts.pop();
      const payload = parts.join(".");
      const [tokenOrgId, tokenRobotId, tokenModelId, expiresAtRaw] = parts;
      if (
        Number(tokenOrgId) !== orgId ||
        Number(tokenRobotId) !== robotId ||
        tokenModelId !== modelId
      ) {
        return false;
      }
      const expiresAt = Number(expiresAtRaw);
      if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
      const expected = createHmac("sha256", this.modelDownloadSecret())
        .update(payload)
        .digest("hex");
      const given = Buffer.from(String(signature ?? ""), "hex");
      const wanted = Buffer.from(expected, "hex");
      return given.length === wanted.length && timingSafeEqual(given, wanted);
    } catch {
      return false;
    }
  }

  async resolveRecognitionPolicy(
    orgId: number,
    robotId: number,
    capabilityKeys: Set<string>,
  ) {
    const robot = await this.ensureRobotOrg(robotId, orgId);
    const hardware = this.robotHardware(robot);
    const rows = await (this.prisma as any).recognitionModel.findMany({
      where: { status: "ACTIVE", fileBytes: { not: null } },
      orderBy: [{ tier: "asc" }, { modelId: "asc" }],
    });
    const proAllowed =
      capabilityKeys.has("identity.recognition.pro") &&
      hardware.ramMb >= 3072 &&
      hardware.androidApi >= 28;
    const allowedModels = rows.filter((model: any) => {
      if (model.tier === "pro" && !proAllowed) return false;
      return hardware.ramMb >= model.minRamMb && hardware.androidApi >= model.minAndroidApi;
    });
    const enabled = capabilityKeys.has("identity.recognition");
    // A robot without face recognition must not be offered models it is not allowed to download.
    const selectedModels = !enabled
      ? []
      : allowedModels.length
        ? allowedModels
        : rows.filter((model: any) => model.tier === "standard").slice(0, 1);
    const thresholds: Record<string, unknown> = {};
    for (const model of selectedModels) {
      thresholds[model.modelId] = await this.thresholdForOrg(orgId, model.modelId);
    }
    return {
      enabled,
      tier: proAllowed ? "pro" : "standard",
      models: selectedModels.map((model: any) => ({
        modelId: model.modelId,
        tier: model.tier,
        version: model.version,
        sha256: model.sha256,
        url: `/api/v1/robot/identity/models/${encodeURIComponent(model.modelId)}`,
      })),
      thresholds,
      galleryPollSeconds: 60,
    };
  }

  async getRecognitionModelDownload(
    orgId: number,
    robotId: number,
    modelId: string,
  ) {
    await this.getRecognitionModelForRobot(orgId, robotId, modelId);
    const model = await (this.prisma as any).recognitionModel.findUnique({
      where: { modelId },
    });
    if (!model?.fileBytes) throw new NotFoundException("Recognition model not found");
    return {
      modelId: model.modelId,
      fileId: model.fileId,
      sha256: model.sha256,
      bytes: Buffer.from(model.fileBytes),
    };
  }

  async uploadRecognitionModel(dto: RecognitionModelUploadDto, actor: Actor) {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException("Only Super Admin can upload recognition models");
    }
    this.assertApprovedModel(dto.modelId);
    await this.assertCatalogueModels([dto.modelId]);
    const bytes = Buffer.from(dto.fileBase64, "base64");
    if (!bytes.length) throw new BadRequestException("Recognition model file is required");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const saved = await (this.prisma as any).recognitionModel.update({
      where: { modelId: dto.modelId },
      data: {
        version: dto.version,
        fileId: `${dto.modelId}-${dto.version}`,
        sha256,
        fileBytes: bytes,
        status: "ACTIVE",
        license: dto.license ?? undefined,
        uploadedAt: new Date(),
        uploadedByUserId: actor.userId,
      },
    });
    await this.audit.recordCritical({
      actor,
      action: "identity_recognition_model.uploaded",
      targetType: "recognition_model",
      targetId: saved.id,
      targetOrgId: null,
      metadata: {
        modelId: saved.modelId,
        version: saved.version,
        sha256: saved.sha256,
        status: saved.status,
      } as any,
    });
    return {
      modelId: saved.modelId,
      version: saved.version,
      sha256: saved.sha256,
      status: saved.status,
      uploadedAt: saved.uploadedAt.toISOString(),
    };
  }

  async create(
    orgId: number,
    dto: CreateIdentityEmbeddingDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    this.validateSubjectRef(dto.subjectRef);
    this.validateConsent(dto);
    this.validateProtectedMetadata(dto.embeddingMetadata);

    const fingerprint = protectedJsonFingerprint(dto.embeddingMetadata);
    const ciphertext = encryptProtectedJson({
      schemaVersion: 1,
      embeddingMetadata: dto.embeddingMetadata,
    });
    const grantedAt = new Date(dto.consent.grantedAt);

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.identityEmbeddingRecord.upsert({
        where: { orgId_subjectRef: { orgId, subjectRef: dto.subjectRef } },
        update: {
          consentGranted: true,
          consentSource: dto.consent.source,
          consentPolicyVersion: dto.consent.policyVersion,
          consentGrantedAt: grantedAt,
          embeddingCiphertext: ciphertext,
          embeddingFingerprint: fingerprint,
          embeddingSchemaVersion: 1,
          retentionExpiresAt: this.retentionExpiryFrom(grantedAt),
          status: "ACTIVE",
          deletedAt: null,
          deletionReason: null,
          createdByUserId: actor.userId,
        },
        create: {
          orgId,
          subjectRef: dto.subjectRef,
          consentGranted: true,
          consentSource: dto.consent.source,
          consentPolicyVersion: dto.consent.policyVersion,
          consentGrantedAt: grantedAt,
          embeddingCiphertext: ciphertext,
          embeddingFingerprint: fingerprint,
          embeddingSchemaVersion: 1,
          retentionExpiresAt: this.retentionExpiryFrom(grantedAt),
          status: "ACTIVE",
          createdByUserId: actor.userId,
        },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "identity_embedding.created",
          targetType: "identity_embedding",
          targetId: row.id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            subjectRef: this.safeSubjectRef(row.subjectRef),
            consentGranted: row.consentGranted,
            consentSource: row.consentSource,
            consentPolicyVersion: row.consentPolicyVersion,
            embeddingSchemaVersion: row.embeddingSchemaVersion,
            status: row.status,
          } as any,
        },
        tx,
      );

      return row;
    });

    return this.toSafeRecord(saved);
  }

  async correct(
    orgId: number,
    id: number,
    dto: UpdateIdentityEmbeddingDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);

    if (!dto.subjectRef && !dto.consent && !dto.embeddingMetadata) {
      throw new BadRequestException("At least one field to update must be provided");
    }

    const existing = await this.prisma.identityEmbeddingRecord.findUnique({
      where: { id },
    });
    if (!existing || existing.orgId !== orgId) {
      throw new NotFoundException("Identity embedding record not found");
    }
    if (existing.status === "DELETED") {
      throw new BadRequestException("Cannot correct an erased identity record");
    }

    if (dto.subjectRef) {
      this.validateSubjectRef(dto.subjectRef);
      if (dto.subjectRef !== existing.subjectRef) {
        const duplicate = await this.prisma.identityEmbeddingRecord.findUnique({
          where: { orgId_subjectRef: { orgId, subjectRef: dto.subjectRef } },
        });
        if (duplicate && duplicate.id !== id) {
          throw new BadRequestException(
            "Identity subject reference already exists in organization",
          );
        }
      }
    }

    let grantedAt: Date | undefined;
    if (dto.consent) {
      if (!dto.consent.granted) {
        throw new BadRequestException("Identity consent must be granted");
      }
      grantedAt = new Date(dto.consent.grantedAt);
      if (Number.isNaN(grantedAt.getTime())) {
        throw new BadRequestException("Identity consent timestamp is invalid");
      }
      if (
        PROHIBITED_PATTERN.test(dto.consent.source) ||
        PROHIBITED_PATTERN.test(dto.consent.policyVersion)
      ) {
        throw new BadRequestException("Identity consent contains blocked data");
      }
    }

    let fingerprint: string | undefined;
    let ciphertext: string | undefined;
    if (dto.embeddingMetadata) {
      this.validateProtectedMetadata(dto.embeddingMetadata);
      fingerprint = protectedJsonFingerprint(dto.embeddingMetadata);
      ciphertext = encryptProtectedJson({
        schemaVersion: 1,
        embeddingMetadata: dto.embeddingMetadata,
      });
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      if (dto.subjectRef) {
        updateData.subjectRef = dto.subjectRef;
      }
      if (dto.consent && grantedAt) {
        updateData.consentGranted = true;
        updateData.consentSource = dto.consent.source;
        updateData.consentPolicyVersion = dto.consent.policyVersion;
        updateData.consentGrantedAt = grantedAt;
        updateData.retentionExpiresAt = this.retentionExpiryFrom(grantedAt);
      }
      if (dto.embeddingMetadata && ciphertext && fingerprint) {
        updateData.embeddingCiphertext = ciphertext;
        updateData.embeddingFingerprint = fingerprint;
        updateData.embeddingSchemaVersion = 1;
      }

      if (existing.status === "REVOKED") {
        const effectiveConsent = dto.consent
          ? dto.consent.granted
          : existing.consentGranted;
        const hasFingerprint = dto.embeddingMetadata
          ? Boolean(fingerprint)
          : Boolean(existing.embeddingFingerprint);
        if (effectiveConsent && hasFingerprint) {
          updateData.status = "ACTIVE";
        }
      }

      const row = await tx.identityEmbeddingRecord.update({
        where: { id },
        data: updateData,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "identity_embedding.corrected",
          targetType: "identity_embedding",
          targetId: row.id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            subjectRef: this.safeSubjectRef(row.subjectRef),
            consentGranted: row.consentGranted,
            consentSource: row.consentSource,
            consentPolicyVersion: row.consentPolicyVersion,
            embeddingSchemaVersion: row.embeddingSchemaVersion,
            status: row.status,
          } as any,
        },
        tx,
      );

      return row;
    });

    return this.toSafeRecord(saved);
  }

  async revokeConsent(
    orgId: number,
    id: number,
    dto: RevokeIdentityConsentDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);

    const existing = await this.prisma.identityEmbeddingRecord.findUnique({
      where: { id },
    });
    if (!existing || existing.orgId !== orgId) {
      throw new NotFoundException("Identity embedding record not found");
    }
    if (existing.status === "DELETED") {
      throw new BadRequestException("Cannot revoke consent for an erased identity record");
    }

    const reason = this.cleanRevocationReason(dto?.reason);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.identityEmbeddingRecord.update({
        where: { id },
        data: {
          consentGranted: false,
          status: "REVOKED",
          embeddingCiphertext: null,
          embeddingFingerprint: null,
        },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "identity_embedding.consent_revoked",
          targetType: "identity_embedding",
          targetId: id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            subjectRef: this.safeSubjectRef(row.subjectRef),
            consentGranted: false,
            status: row.status,
            reason,
          } as any,
        },
        tx,
      );

      return row;
    });

    return this.toSafeRecord(saved);
  }

  async erase(
    orgId: number,
    id: number,
    dto: DeleteIdentityEmbeddingDto,
    actor: Actor,
    correlationId?: string,
  ) {
    await this.ensureOrgAccess(actor, orgId);
    await this.ensureActiveOrg(orgId);
    const existing = await this.prisma.identityEmbeddingRecord.findUnique({
      where: { id },
    });
    if (!existing || existing.orgId !== orgId) {
      throw new NotFoundException("Identity embedding record not found");
    }

    const reason = this.cleanDeletionReason(dto.reason);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.identityEmbeddingRecord.update({
        where: { id },
        data: {
          status: "DELETED",
          embeddingCiphertext: null,
          embeddingFingerprint: null,
          deletedAt: new Date(),
          deletionReason: reason,
        },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "identity_embedding.erased",
          targetType: "identity_embedding",
          targetId: id,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            subjectRef: this.safeSubjectRef(row.subjectRef),
            status: row.status,
            reason,
          } as any,
        },
        tx,
      );

      return row;
    });

    return this.toSafeRecord(saved);
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

  private async ensureRobotOrg(robotId: number, orgId: number) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: {
        id: true,
        orgId: true,
        revokedAt: true,
        validUntil: true,
        deviceMetadata: true,
        hardwareCapabilities: true,
      },
    });
    if (!robot || robot.orgId !== orgId) {
      throw new ForbiddenException("Robot is not authorized for identity gallery");
    }
    if (robot.revokedAt || robot.validUntil.getTime() < Date.now()) {
      throw new ForbiddenException("Robot license is not active");
    }
    return robot;
  }

  private async withRobotIdempotency<T>(
    orgId: number,
    robotId: number,
    route: RobotIdentityRoute,
    key: string | undefined,
    handler: () => Promise<T>,
  ): Promise<T> {
    const idempotencyKey = key?.trim();
    if (!idempotencyKey) return handler();
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
      throw new BadRequestException("Idempotency-Key is invalid");
    }

    const existing = await (this.prisma as any).robotIdentityIdempotency.findUnique({
      where: {
        orgId_robotId_route_idempotencyKey: {
          orgId,
          robotId,
          route,
          idempotencyKey,
        },
      },
    });
    if (existing) return existing.response as T;

    const response = await handler();
    try {
      await (this.prisma as any).robotIdentityIdempotency.create({
        data: {
          orgId,
          robotId,
          route,
          idempotencyKey,
          response: response as any,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch {
      const replay = await (this.prisma as any).robotIdentityIdempotency.findUnique({
        where: {
          orgId_robotId_route_idempotencyKey: {
            orgId,
            robotId,
            route,
            idempotencyKey,
          },
        },
      });
      if (replay) return replay.response as T;
      throw new BadRequestException("Idempotent request could not be recorded");
    }
    return response;
  }

  private validateConsent(dto: CreateIdentityEmbeddingDto) {
    if (!dto.consent?.granted) {
      throw new BadRequestException("Identity consent is required");
    }
    const grantedAt = new Date(dto.consent.grantedAt);
    if (Number.isNaN(grantedAt.getTime())) {
      throw new BadRequestException("Identity consent timestamp is invalid");
    }
  }

  private validateSubjectRef(value: string) {
    if (PROHIBITED_PATTERN.test(value)) {
      throw new BadRequestException("Identity subject reference contains blocked data");
    }
  }

  private validateProtectedMetadata(value: unknown, depth = 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Embedding metadata is invalid");
    }
    if (depth > 4) {
      throw new BadRequestException("Embedding metadata is too deeply nested");
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(key)) {
        throw new BadRequestException("Embedding metadata key is invalid");
      }
      if (typeof item === "string" && PROHIBITED_PATTERN.test(item)) {
        throw new BadRequestException("Embedding metadata contains blocked data");
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        this.validateProtectedMetadata(item, depth + 1);
      }
    }
  }

  private normalizeRobotEmbedding(dto: RobotIdentityEnrollmentDto) {
    if (!dto.consent?.granted) {
      throw new BadRequestException("Identity consent is required");
    }
    this.assertApprovedModel(dto.embedding.modelId);
    this.assertVector(dto.embedding.vector, dto.embedding.dimension);
    const metadata = {
      modelId: dto.embedding.modelId,
      dimension: dto.embedding.dimension,
      vector: dto.embedding.vector,
      ...(dto.displayName ? { displayName: dto.displayName.trim() } : {}),
    };
    this.validateProtectedMetadata(metadata);
    return metadata;
  }

  private async storeEnrollmentTemplates(
    orgId: number,
    robotId: number,
    identityId: number,
    templates: RobotIdentityEmbeddingDto[],
    idempotencyKey?: string,
  ) {
    if (!Array.isArray(templates) || templates.length < 1 || templates.length > 5) {
      throw new BadRequestException("Identity enrollment requires 1 to 5 templates");
    }
    for (const template of templates) {
      this.assertApprovedModel(template.modelId);
      this.assertVector(template.vector, template.dimension);
      const payload = {
        modelId: template.modelId,
        dimension: template.dimension,
        vector: template.vector,
        sourceRobotId: robotId,
        idempotencyKey: idempotencyKey ?? null,
        enrollment: true,
      };
      await (this.prisma as any).identityTemplate.create({
        data: {
          identityId,
          modelId: template.modelId,
          vectorCiphertext: encryptProtectedJson(payload),
          vectorFingerprint: protectedJsonFingerprint(payload),
          qualityScore: 1,
          sourceRobotId: robotId,
        },
      });
    }
    await this.pruneTemplates(identityId);
    await this.audit.recordBestEffort({
      actor: { userId: null, orgId, isSuperAdmin: false },
      action: "identity_template.enrollment_uploaded",
      targetType: "identity_embedding",
      targetId: identityId,
      targetOrgId: orgId,
      correlationId: idempotencyKey,
      metadata: {
        templateCount: templates.length,
        sourceRobotId: robotId,
      } as any,
    });
  }

  private async pruneTemplates(identityId: number) {
    const templates = await (this.prisma as any).identityTemplate.findMany({
      where: { identityId },
      orderBy: [{ qualityScore: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const excess = templates.length - 10;
    if (excess > 0) {
      await (this.prisma as any).identityTemplate.deleteMany({
        where: { id: { in: templates.slice(0, excess).map((item: { id: number }) => item.id) } },
      });
    }
  }

  private decryptEmbeddingMetadata(ciphertext: string) {
    const decrypted = decryptProtectedJson(ciphertext) as Record<string, unknown>;
    const metadata = decrypted.embeddingMetadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new BadRequestException("Identity embedding metadata is invalid");
    }
    const record = metadata as Record<string, unknown>;
    return {
      modelId: typeof record.modelId === "string" ? record.modelId : "unknown",
      dimension: typeof record.dimension === "number" ? record.dimension : 0,
      vector: typeof record.vector === "string" ? record.vector : "",
      displayName: record.displayName,
    };
  }

  /** Rejects model ids that are not in the recognition model catalogue (400 instead of a foreign-key 500). */
  private async assertCatalogueModels(modelIds: Array<string | undefined>) {
    const wanted = Array.from(new Set(modelIds.filter((id): id is string => Boolean(id))));
    if (!wanted.length) return;
    const found = await (this.prisma as any).recognitionModel.findMany({
      where: { modelId: { in: wanted } },
      select: { modelId: true },
    });
    const known = new Set(found.map((row: { modelId: string }) => row.modelId));
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length) {
      throw new BadRequestException("Recognition model is not in the catalogue");
    }
  }

  private assertApprovedModel(modelId: string) {
    if (!ALLOWED_RECOGNITION_MODELS.has(modelId)) {
      throw new BadRequestException("Identity embedding model is not approved");
    }
  }

  private assertVector(vector: string, dimension: number) {
    if (dimension > 4096) {
      throw new BadRequestException("Identity embedding dimension is too large");
    }
    const vectorBytes = Buffer.from(vector, "base64");
    if (vectorBytes.length !== dimension * 4) {
      throw new BadRequestException("Identity embedding vector length is invalid");
    }
    for (let offset = 0; offset < vectorBytes.length; offset += 4) {
      const value = vectorBytes.readFloatLE(offset);
      if (!Number.isFinite(value)) {
        throw new BadRequestException("Identity embedding vector contains invalid values");
      }
    }
  }

  private async thresholdForOrg(orgId: number, modelId: string) {
    const override = await (this.prisma as any).organizationIdentityThreshold.findUnique({
      where: { orgId_modelId: { orgId, modelId } },
    });
    return {
      accept: override?.accept ?? 0.363,
      margin: override?.margin ?? 0.08,
      reject: override?.reject ?? 0.25,
      votes: override?.votes ?? 3,
    };
  }

  private async needsReregistration(identityId: number) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const count = await (this.prisma as any).identityRecognitionFeedback.count({
      where: {
        identityId,
        outcome: "rejected",
        createdAt: { gte: since },
      },
    });
    return count >= 3;
  }

  private computeGalleryVersion(
    orgId: number,
    upserts: Array<Record<string, unknown>>,
    deletions: Array<Record<string, unknown>>,
    templates: Array<Record<string, unknown>>,
  ) {
    const version = protectedJsonFingerprint({
      orgId,
      upserts: upserts.map((item) => [item.id, item.modelId, item.updatedAt]),
      deletions: deletions.map((item) => [item.id, item.deletedAt]),
      templates: templates.map((item) => [
        item.identityId,
        item.modelId,
        item.vectorFingerprint,
        item.qualityScore,
      ]),
    }).slice(0, 24);
    return `identity-gallery-org-${orgId}-${version}`;
  }

  private robotHardware(robot: { deviceMetadata?: unknown; hardwareCapabilities?: unknown }) {
    const metadata =
      robot.deviceMetadata && typeof robot.deviceMetadata === "object"
        ? (robot.deviceMetadata as Record<string, unknown>)
        : {};
    const hardware =
      robot.hardwareCapabilities && typeof robot.hardwareCapabilities === "object"
        ? (robot.hardwareCapabilities as Record<string, unknown>)
        : {};
    return {
      ramMb: this.readNumber(metadata.ramMb ?? hardware.ramMb, 0),
      androidApi: this.readNumber(
        metadata.androidApiLevel ?? metadata.androidApi ?? hardware.androidApiLevel,
        0,
      ),
    };
  }

  private readNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private signModelDownload(orgId: number, robotId: number, modelId: string) {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const payload = `${orgId}.${robotId}.${modelId}.${expiresAt}`;
    const signature = createHmac("sha256", this.modelDownloadSecret())
      .update(payload)
      .digest("hex");
    return Buffer.from(`${payload}.${signature}`).toString("base64url");
  }

  private modelDownloadSecret() {
    const secret =
      this.config?.get<string>("LICENSE_SECRET_KEY") ?? process.env.LICENSE_SECRET_KEY;
    if (!secret?.trim()) {
      throw new Error("LICENSE_SECRET_KEY is required to sign model downloads");
    }
    return secret;
  }

  private cleanDeletionReason(value?: string) {
    const reason = value?.trim() || "requested_erasure";
    if (PROHIBITED_PATTERN.test(reason)) {
      throw new BadRequestException("Deletion reason contains blocked data");
    }
    return reason.slice(0, 160);
  }

  private cleanRevocationReason(value?: string) {
    const reason = value?.trim() || "consent_revoked";
    if (PROHIBITED_PATTERN.test(reason)) {
      throw new BadRequestException("Revocation reason contains blocked data");
    }
    return reason.slice(0, 160);
  }

  private safeSubjectRef(value: string) {
    return PROHIBITED_PATTERN.test(value) ? "[redacted]" : value;
  }

  private retentionExpiryFrom(grantedAt: Date) {
    const days = this.identityRetentionDays();
    return new Date(grantedAt.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private identityRetentionDays() {
    const configured = Number(this.config?.get<string>("IDENTITY_RETENTION_DAYS") ?? "365");
    if (!Number.isInteger(configured) || configured < 1 || configured > 3650) {
      return 365;
    }
    return configured;
  }

  private toSafeRecord(record: IdentityRecord) {
    return {
      id: record.id,
      orgId: record.orgId,
      subjectRef: this.safeSubjectRef(record.subjectRef),
      consent: {
        granted: record.consentGranted,
        source: record.consentSource,
        policyVersion: record.consentPolicyVersion,
        grantedAt: record.consentGrantedAt.toISOString(),
      },
      embedding: {
        schemaVersion: record.embeddingSchemaVersion,
        fingerprint: record.embeddingFingerprint,
        encrypted: Boolean(record.embeddingFingerprint),
      },
      status: record.status,
      retentionExpiresAt: record.retentionExpiresAt?.toISOString() ?? null,
      deletedAt: record.deletedAt?.toISOString() ?? null,
      deletionReason: record.deletionReason,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
