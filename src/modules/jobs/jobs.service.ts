import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

type CmsJobData = Record<string, never>;

const PROHIBITED_PATTERN =
  /(Bearer\s+[A-Za-z0-9._-]+|WHRB\d{6}|sk-[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d ()-]{8,}\d)/i;

@Injectable()
export class JobsService implements OnModuleInit {
  private queue!: Queue<CmsJobData>;
  private worker!: Worker<CmsJobData>;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Optional()
    private audit?: AuditService,
  ) {}

  async onModuleInit() {
    const redisEnabled = this.config.get<string>('REDIS_ENABLED') === 'true';
    if (!redisEnabled) {
      // eslint-disable-next-line no-console
      console.log('BullMQ disabled by REDIS_ENABLED=false');
      return;
    }

    try {
      const redisUrl = this.config.get<string>('REDIS_URL');
      if (!redisUrl) {
        throw new Error('REDIS_URL is required when REDIS_ENABLED=true');
      }

      const connection = new IORedis(redisUrl, { 
        maxRetriesPerRequest: null,
        retryStrategy: () => null, // Don't retry - fail immediately if unavailable
        connectTimeout: 1000, // 1 second timeout
      });

      // Wait for connection to establish
      await connection.ping();

      this.queue = new Queue<CmsJobData>('whizrobot-jobs', { connection });

      // Schedule daily license scan (Phase 1: runs in same process)
      await this.queue.add(
        'license-scan',
        {},
        { repeat: { pattern: '0 0 * * *' }, removeOnComplete: true, removeOnFail: true },
      );
      await this.queue.add(
        'identity-retention-scan',
        {},
        { repeat: { pattern: '15 0 * * *' }, removeOnComplete: true, removeOnFail: true },
      );

      // Worker processor
      this.worker = new Worker<CmsJobData>(
        'whizrobot-jobs',
        async (job) => {
          if (job.name === 'license-scan') {
            await this.runLicenseScan();
          }
          if (job.name === 'identity-retention-scan') {
            await this.runIdentityRetentionScan();
          }
        },
        { connection },
      );

      this.worker.on('failed', (job, err) => {
        // eslint-disable-next-line no-console
        console.error('Job failed', job?.name, err);
      });

      // eslint-disable-next-line no-console
      console.log('✅ BullMQ initialized');
    } catch (error) {
      throw new Error(`Redis startup check failed: ${(error as Error).message}`);
    }
  }

  private computeStatus(validUntil: Date, revokedAt: Date | null): { status: LicenseStatus; daysLeft: number } {
    if (revokedAt) return { status: LicenseStatus.REVOKED, daysLeft: -1 };

    const now = new Date();
    const msLeft = validUntil.getTime() - now.getTime();
    const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));

    if (now > validUntil) return { status: LicenseStatus.EXPIRED, daysLeft };
    if (daysLeft <= 30) return { status: LicenseStatus.EXPIRING_SOON, daysLeft };

    return { status: LicenseStatus.ACTIVE, daysLeft };
  }

  private async createOrgNotification(params: {
    orgId: number;
    type: string;
    title: string;
    message: string;
    payload: any;
  }) {
    // Dedupe: only one notification per (orgId,type,message).
    // Message is intentionally stable (includes robot serial + validUntil ISO date).
    const existing = await this.prisma.notification.findFirst({
      where: { orgId: params.orgId, type: params.type, message: params.message },
    });

    if (existing) return;

    try {
      await this.prisma.notification.create({
        data: {
          orgId: params.orgId,
          type: params.type,
          title: params.title,
          message: params.message,
          payload: params.payload,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
  }

  private async runLicenseScan() {
    const robots = await this.prisma.robot.findMany({
      where: { revokedAt: null },
      select: {
        id: true,
        orgId: true,
        serialNumber: true,
        validUntil: true,
        validFrom: true,
        licenseStatus: true,
        revokedAt: true,
      },
    });

    for (const r of robots) {
      const { status, daysLeft } = this.computeStatus(r.validUntil, r.revokedAt);

      if (status !== r.licenseStatus) {
        await this.prisma.robot.updateMany({
          where: { id: r.id, licenseStatus: { not: status } },
          data: { licenseStatus: status },
        });
      }

      const validUntilIso = r.validUntil.toISOString();

      if (status === LicenseStatus.EXPIRED) {
        await this.createOrgNotification({
          orgId: r.orgId,
          type: 'LICENSE_EXPIRED',
          title: 'Robot license expired',
          message: `Robot ${r.serialNumber} license expired on ${validUntilIso}. Robot is now locked.`,
          payload: { robotId: r.id, serialNumber: r.serialNumber, validUntil: validUntilIso },
        });
      }

      // Pre-expiry notifications (dashboard only)
      if (status === LicenseStatus.EXPIRING_SOON) {
        if (daysLeft <= 7) {
          await this.createOrgNotification({
            orgId: r.orgId,
            type: 'LICENSE_EXPIRING_7',
            title: 'Robot license expiring soon (7 days)',
            message: `Robot ${r.serialNumber} license expires on ${validUntilIso}.`,
            payload: { robotId: r.id, serialNumber: r.serialNumber, validUntil: validUntilIso, daysLeft },
          });
        } else {
          await this.createOrgNotification({
            orgId: r.orgId,
            type: 'LICENSE_EXPIRING_30',
            title: 'Robot license expiring soon (30 days)',
            message: `Robot ${r.serialNumber} license expires on ${validUntilIso}.`,
            payload: { robotId: r.id, serialNumber: r.serialNumber, validUntil: validUntilIso, daysLeft },
          });
        }
      }
    }
  }

  private async runIdentityRetentionScan() {
    const now = new Date();
    const expiredRecords = await (this.prisma as any).identityEmbeddingRecord.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        retentionExpiresAt: { lte: now },
      },
      select: {
        id: true,
        orgId: true,
        subjectRef: true,
        retentionExpiresAt: true,
        embeddingSchemaVersion: true,
      },
      orderBy: [{ retentionExpiresAt: 'asc' }, { id: 'asc' }],
    });

    for (const record of expiredRecords) {
      await this.prisma.$transaction(async (tx) => {
        const result = await (tx as any).identityEmbeddingRecord.updateMany({
          where: {
            id: record.id,
            status: 'ACTIVE',
            deletedAt: null,
            retentionExpiresAt: { lte: now },
          },
          data: {
            status: 'DELETED',
            embeddingCiphertext: null,
            embeddingFingerprint: null,
            deletedAt: now,
            deletionReason: 'retention_expired',
          },
        });

        if (!result.count) return;

        if (!this.audit) return;
        await this.audit.recordCritical(
          {
            actor: { userId: null, orgId: null, isSuperAdmin: true },
            action: 'identity_embedding.retention_deleted',
            targetType: 'identity_embedding',
            targetId: record.id,
            targetOrgId: record.orgId,
            metadata: {
              subjectRef: this.safeSubjectRef(record.subjectRef),
              status: 'DELETED',
              reason: 'retention_expired',
              retentionExpiresAt: record.retentionExpiresAt?.toISOString() ?? null,
              embeddingSchemaVersion: record.embeddingSchemaVersion,
            },
          },
          tx,
        );
      });
    }
  }

  private safeSubjectRef(value: string) {
    return PROHIBITED_PATTERN.test(value) ? '[redacted]' : value;
  }
}
