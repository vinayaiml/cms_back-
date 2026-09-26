import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditEvent, LicenseStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { decryptLicenseKey, encryptLicenseKey, licenseFingerprint, maskLicenseKey } from '../../common/security/license-secret';
import { normalizeRobotHardwareProfile } from './robot-hardware-profile';

@Injectable()
export class RobotsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private readonly robotSelect = {
    id: true,
    orgId: true,
    serialNumber: true,
    name: true,
    validFrom: true,
    validUntil: true,
    licenseStatus: true,
    revokedAt: true,
    lastSeenAt: true,
    appVersion: true,
    deviceModel: true,
    deviceMetadata: true,
    hardwareModel: true,
    hardwareProfile: true,
    hardwareCapabilities: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private readonly robotEnrollmentSelect = {
    ...this.robotSelect,
    licenseKey: true,
    licenseKeyCiphertext: true,
  } as const;

  private readonly protectedRobotSelect = {
    ...this.robotSelect,
    licenseKey: true,
    licenseKeyCiphertext: true,
    licenseKeyFingerprint: true,
  } as const;

  private readonly superAdminRobotSelect = {
    ...this.robotSelect,
    licenseKey: true,
    licenseKeyCiphertext: true,
  } as const;

  private buildFleetWhere(filters: {
    orgId?: number;
    status?: LicenseStatus;
    model?: string;
    version?: string;
    lastSeenFrom?: Date;
    lastSeenTo?: Date;
  } = {}): Prisma.RobotWhereInput {
    const where: Prisma.RobotWhereInput = {};

    if (filters.orgId !== undefined) where.orgId = filters.orgId;
    if (filters.status) where.licenseStatus = filters.status;
    if (filters.model) where.hardwareModel = filters.model;
    if (filters.version) where.appVersion = filters.version;
    if (filters.lastSeenFrom || filters.lastSeenTo) {
      where.lastSeenAt = {
        ...(filters.lastSeenFrom ? { gte: filters.lastSeenFrom } : {}),
        ...(filters.lastSeenTo ? { lte: filters.lastSeenTo } : {}),
      };
    }

    return where;
  }

  private clampLimit(limit?: number) {
    if (limit === undefined || !Number.isFinite(limit)) return undefined;
    return Math.min(Math.max(Math.trunc(limit), 1), 100);
  }

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private toRobotReassignmentHistoryItem(event: AuditEvent) {
    const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown>
      : {};

    return {
      id: event.id,
      robotId: Number(event.targetId),
      actorUserId: event.actorUserId,
      actorOrgId: event.actorOrgId,
      oldOrgId: typeof metadata.oldOrgId === 'number' ? metadata.oldOrgId : null,
      newOrgId: typeof metadata.newOrgId === 'number' ? metadata.newOrgId : event.targetOrgId,
      targetOrgId: event.targetOrgId,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
    };
  }

  private toRobotAuditHistoryItem(event: AuditEvent) {
    const sanitizedMetadata = this.audit.sanitizeMetadata(event.metadata);

    return {
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId,
      actorOrgId: event.actorOrgId,
      targetOrgId: event.targetOrgId,
      correlationId: event.correlationId,
      metadata: sanitizedMetadata && typeof sanitizedMetadata === 'object' ? sanitizedMetadata : null,
      createdAt: event.createdAt,
    };
  }

  private generateLicenseKeyCandidate(): string {
    const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return `WHRB${value.toString().padStart(6, '0')}`;
  }

  private async generateUniqueLicenseKey(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const licenseKey = this.generateLicenseKeyCandidate();
      const existing = await this.prisma.robot.findFirst({
        where: {
          OR: [
            { licenseKey },
            { licenseKeyFingerprint: licenseFingerprint(licenseKey) },
          ],
        },
        select: { id: true },
      });
      if (!existing) return licenseKey;
    }

    throw new Error('Unable to generate unique robot license key');
  }

  private readProtectedLicenseKey(robot: { licenseKey: string | null; licenseKeyCiphertext?: string | null }) {
    if (robot.licenseKeyCiphertext) return decryptLicenseKey(robot.licenseKeyCiphertext);
    return robot.licenseKey;
  }

  private toSuperAdminRobotResponse<T extends { licenseKey: string | null; licenseKeyCiphertext?: string | null }>(robot: T) {
    const fullLicenseKey = this.readProtectedLicenseKey(robot);
    const { licenseKey: _legacyLicenseKey, licenseKeyCiphertext: _ciphertext, ...rest } = robot;

    return {
      ...rest,
      licenseKey: fullLicenseKey,
      licenseKeyMasked: maskLicenseKey(fullLicenseKey),
    };
  }

  async listByOrg(
    orgId: number,
    filters: {
      status?: LicenseStatus;
      model?: string;
      version?: string;
      lastSeenFrom?: Date;
      lastSeenTo?: Date;
      limit?: number;
    } = {},
  ) {
    const take = this.clampLimit(filters.limit);
    return this.prisma.robot.findMany({
      where: this.buildFleetWhere({ ...filters, orgId }),
      orderBy: { id: 'desc' },
      ...(take ? { take } : {}),
      select: this.robotSelect,
    });
  }

  async listAll(filters: {
    orgId?: number;
    status?: LicenseStatus;
    model?: string;
    version?: string;
    lastSeenFrom?: Date;
    lastSeenTo?: Date;
    limit?: number;
  } = {}) {
    const take = this.clampLimit(filters.limit);
    const robots = await this.prisma.robot.findMany({
      where: this.buildFleetWhere(filters),
      orderBy: { id: 'desc' },
      ...(take ? { take } : {}),
      select: {
        ...this.superAdminRobotSelect,
        org: { select: { id: true, name: true } },
      },
    });

    return robots.map((robot) => this.toSuperAdminRobotResponse(robot));
  }

  async getDetail(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
    limit = 50,
  ) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: {
        ...this.robotSelect,
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            tenantVersion: true,
          },
        },
      },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    await this.ensureOrgAccess(actor, robot.orgId);

    const take = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 50, 1), 100);
    const auditHistory = await this.prisma.auditEvent.findMany({
      where: {
        targetType: 'robot',
        targetId: String(robotId),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const {
      licenseKey: _licenseKey,
      licenseKeyCiphertext: _licenseKeyCiphertext,
      licenseKeyFingerprint: _licenseKeyFingerprint,
      ...safeRobot
    } = robot as typeof robot & {
      licenseKey?: string | null;
      licenseKeyCiphertext?: string | null;
      licenseKeyFingerprint?: string | null;
    };

    return {
      robot: safeRobot,
      license: {
        status: robot.licenseStatus,
        validFrom: robot.validFrom,
        validUntil: robot.validUntil,
        revokedAt: robot.revokedAt,
      },
      auditHistory: auditHistory.map((event) => this.toRobotAuditHistoryItem(event)),
    };
  }

  async createRobot(
    input: {
      orgId: number;
      serialNumber: string;
      name?: string;
      validFrom: Date;
      validUntil: Date;
      hardwareProfile?: {
        model?: string;
        manufacturer?: string;
        androidApiLevel?: number;
        abi?: string;
        display?: {
          width?: number;
          height?: number;
        };
        capabilities?: Record<string, unknown>;
      };
    },
    actor?: { userId: number | null; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const hardware = normalizeRobotHardwareProfile(input.hardwareProfile);
    const existingSerial = await this.prisma.robot.findUnique({
      where: { serialNumber: input.serialNumber },
      select: { id: true },
    });
    if (existingSerial) throw new ConflictException('Robot serial number already exists');

    const licenseKey = await this.generateUniqueLicenseKey();
    const status = this.computeLicenseStatus(input.validUntil, null);

    return this.prisma.$transaction(async (tx) => {
      const robot = await tx.robot
        .create({
          data: {
            orgId: input.orgId,
            serialNumber: input.serialNumber,
            name: input.name,
            licenseKey: null,
            licenseKeyCiphertext: encryptLicenseKey(licenseKey),
            licenseKeyFingerprint: licenseFingerprint(licenseKey),
            validFrom: input.validFrom,
            validUntil: input.validUntil,
            licenseStatus: status,
            hardwareModel: hardware.hardwareModel,
            hardwareProfile: hardware.hardwareProfile ?? Prisma.JsonNull,
            hardwareCapabilities: hardware.hardwareCapabilities ?? Prisma.JsonNull,
          },
          select: this.robotEnrollmentSelect,
        })
        .catch((error) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002' &&
            Array.isArray(error.meta?.target) &&
            error.meta.target.includes('serialNumber')
          ) {
            throw new ConflictException('Robot serial number already exists');
          }
          throw error;
        });

      if (actor) {
        await this.audit.recordCritical(
          {
            actor,
            action: 'robot.enrolled',
            targetType: 'robot',
            targetId: robot.id,
            targetOrgId: robot.orgId,
            correlationId,
            metadata: {
              serialNumber: robot.serialNumber,
              licenseStatus: robot.licenseStatus,
              validFrom: robot.validFrom,
              validUntil: robot.validUntil,
              hardwareModel: robot.hardwareModel,
            },
          },
          tx,
        );
      }

      return this.toSuperAdminRobotResponse(robot);
    });
  }

  async renewLicense(robotId: number, validUntil: Date) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');

    const status = this.computeLicenseStatus(validUntil, robot.revokedAt);

    // Renewal extends validity on the SAME license_key
    return this.prisma.robot.update({
      where: { id: robotId },
      data: { validUntil, licenseStatus: status },
      select: this.robotSelect,
    });
  }

  async rotateCredential(
    robotId: number,
    actor: { userId: number | null; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    if (!actor.isSuperAdmin) throw new ForbiddenException('Only Super Admin can rotate robot credentials');

    const robot = await this.getRobotOrThrow(robotId);
    const licenseKey = await this.generateUniqueLicenseKey();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          licenseKey: null,
          licenseKeyCiphertext: encryptLicenseKey(licenseKey),
          licenseKeyFingerprint: licenseFingerprint(licenseKey),
        },
        select: this.robotEnrollmentSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: 'robot.credential_rotated',
          targetType: 'robot',
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
            licenseStatus: robot.licenseStatus,
          },
        },
        tx,
      );

      return this.toSuperAdminRobotResponse(updated);
    });
  }

  async revokeCredential(
    robotId: number,
    actor: { userId: number | null; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    if (!actor.isSuperAdmin) throw new ForbiddenException('Only Super Admin can revoke robot credentials');

    const robot = await this.getRobotOrThrow(robotId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          revokedAt: new Date(),
          licenseStatus: LicenseStatus.REVOKED,
        },
        select: this.robotSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: 'robot.credential_revoked',
          targetType: 'robot',
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
            previousLicenseStatus: robot.licenseStatus,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async lockRobot(robotId: number, lock: boolean) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');

    if (lock) {
      return this.prisma.robot.update({
        where: { id: robotId },
        data: { revokedAt: new Date(), licenseStatus: LicenseStatus.REVOKED },
        select: this.robotSelect,
      });
    }

    // unlock (revokedAt cleared; status recalculated)
    const status = this.computeLicenseStatus(robot.validUntil, null);

    return this.prisma.robot.update({
      where: { id: robotId },
      data: { revokedAt: null, licenseStatus: status },
      select: this.robotSelect,
    });
  }

  async reassignRobot(
    robotId: number,
    newOrgId: number,
    actor: { userId: number | null; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    if (!actor.isSuperAdmin) throw new ForbiddenException('Only Super Admin can reassign robots');

    const robot = await this.getRobotOrThrow(robotId);
    if (robot.orgId === newOrgId) {
      return this.prisma.robot.findUnique({
        where: { id: robotId },
        select: {
          ...this.robotSelect,
          org: { select: { id: true, name: true, tenantVersion: true } },
        },
      });
    }

    const targetOrg = await this.prisma.organization.findUnique({
      where: { id: newOrgId },
      select: { id: true, isActive: true },
    });
    if (!targetOrg) throw new NotFoundException('Target organization not found');
    if (!targetOrg.isActive) throw new ForbiddenException('Target organization is inactive');

    return this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: robot.orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { id: true },
      });

      const updatedOrg = await tx.organization.update({
        where: { id: newOrgId },
        data: { tenantVersion: { increment: 1 } },
        select: { id: true, tenantVersion: true },
      });

      const updated = await tx.robot.update({
        where: { id: robotId },
        data: { orgId: newOrgId },
        select: {
          ...this.robotSelect,
          org: { select: { id: true, name: true, tenantVersion: true } },
        },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: 'robot.reassigned',
          targetType: 'robot',
          targetId: robotId,
          targetOrgId: newOrgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
            oldOrgId: robot.orgId,
            newOrgId,
            newTenantVersion: updatedOrg.tenantVersion,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async listReassignmentHistory(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
    limit = 50,
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    const take = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 50, 1), 100);
    const events = await this.prisma.auditEvent.findMany({
      where: {
        action: 'robot.reassigned',
        targetType: 'robot',
        targetId: String(robotId),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return events.map((event) => this.toRobotReassignmentHistoryItem(event));
  }

  async clearDeviceMetadata(
    robotId: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          appVersion: null,
          deviceModel: null,
          deviceMetadata: Prisma.DbNull,
        },
        select: this.robotSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: 'robot.device_metadata_erased',
          targetType: 'robot',
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async getRobotOrThrow(robotId: number) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');
    return robot;
  }

  async ensureOrgAccess(actor: { orgId: number | null; isSuperAdmin: boolean }, targetOrgId: number) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (actor.orgId !== targetOrgId) throw new ForbiddenException('Cannot access other org');
  }
}
