import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseStatus, Prisma } from '@prisma/client';
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

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
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

  async listByOrg(orgId: number) {
    return this.prisma.robot.findMany({
      where: { orgId },
      orderBy: { id: 'desc' },
      select: this.robotSelect,
    });
  }

  async listAll(orgId?: number) {
    const robots = await this.prisma.robot.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { id: 'desc' },
      select: {
        ...this.superAdminRobotSelect,
        org: { select: { id: true, name: true } },
      },
    });

    return robots.map((robot) => this.toSuperAdminRobotResponse(robot));
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
    const licenseKey = await this.generateUniqueLicenseKey();
    const status = this.computeLicenseStatus(input.validUntil, null);

    return this.prisma.$transaction(async (tx) => {
      const robot = await tx.robot.create({
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
