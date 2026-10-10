import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  encryptProtectedJson,
  protectedJsonFingerprint,
} from "../../common/security/protected-json";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  CreateIdentityEmbeddingDto,
  DeleteIdentityEmbeddingDto,
  RevokeIdentityConsentDto,
  UpdateIdentityEmbeddingDto,
} from "./identity.dto";

type Actor = {
  userId: number;
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

const PROHIBITED_PATTERN =
  /(Bearer\s+[A-Za-z0-9._-]+|WHRB\d{6}|sk-[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d ()-]{8,}\d)/i;

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
    const rows = await (this.prisma as any).identityEmbeddingRecord.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row: any) => this.toSafeRecord(row));
  }

  async getAuthorizedGalleryForOrg(orgId: number) {
    const rows = await (this.prisma as any).identityEmbeddingRecord.findMany({
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

    return rows.map((row: any) => ({
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
      const row = await (tx as any).identityEmbeddingRecord.upsert({
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

    const existing = await (this.prisma as any).identityEmbeddingRecord.findUnique({
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
        const duplicate = await (this.prisma as any).identityEmbeddingRecord.findUnique({
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

      const row = await (tx as any).identityEmbeddingRecord.update({
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

    const existing = await (this.prisma as any).identityEmbeddingRecord.findUnique({
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
      const row = await (tx as any).identityEmbeddingRecord.update({
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
    const existing = await (this.prisma as any).identityEmbeddingRecord.findUnique({
      where: { id },
    });
    if (!existing || existing.orgId !== orgId) {
      throw new NotFoundException("Identity embedding record not found");
    }

    const reason = this.cleanDeletionReason(dto.reason);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await (tx as any).identityEmbeddingRecord.update({
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
