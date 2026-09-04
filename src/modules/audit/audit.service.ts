import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditActor, AuditListFilters, RecordAuditEventInput } from './audit.types';

const SENSITIVE_KEY_PATTERN =
  /(password|passcode|token|jwt|secret|authorization|cookie|hash|apiKey|licenseKey|privateKey|accessKey|refreshToken)/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  sanitizeMetadata(value: unknown): Prisma.InputJsonValue | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => this.sanitizeMetadata(item)) as Prisma.InputJsonArray;

    if (typeof value === 'object') {
      const clean: Record<string, Prisma.InputJsonValue> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        const sanitized = this.sanitizeMetadata(item);
        if (sanitized !== null) clean[key] = sanitized;
      }
      return clean;
    }

    return String(value);
  }

  async recordCritical(input: RecordAuditEventInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.auditEvent.create({
      data: this.toCreateData(input),
    });
  }

  async recordBestEffort(input: RecordAuditEventInput) {
    try {
      return await this.recordCritical(input);
    } catch {
      this.logger.error(`Audit write failed for action=${input.action} target=${input.targetType}:${input.targetId}`);
      return null;
    }
  }

  async listForActor(actor: AuditActor, filters: AuditListFilters = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const where: Prisma.AuditEventWhereInput = {};

    if (filters.action) where.action = filters.action;
    if (filters.targetType) where.targetType = filters.targetType;

    if (actor.isSuperAdmin) {
      if (filters.orgId) where.targetOrgId = filters.orgId;
    } else {
      where.targetOrgId = actor.orgId ?? -1;
    }

    return this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private toCreateData(input: RecordAuditEventInput): Prisma.AuditEventCreateInput {
    const data: Prisma.AuditEventCreateInput = {
      actorUserId: input.actor.userId,
      actorOrgId: input.actor.orgId,
      action: input.action,
      targetType: input.targetType,
      targetId: String(input.targetId),
      targetOrgId: input.targetOrgId ?? input.actor.orgId,
      correlationId: this.cleanCorrelationId(input.correlationId),
    };

    const metadata = this.sanitizeMetadata(input.metadata);
    if (metadata !== null) data.metadata = metadata;

    return data;
  }

  private cleanCorrelationId(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) return randomUUID();
    return trimmed.slice(0, 128);
  }
}
