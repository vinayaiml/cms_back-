import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../../common/auth/jwt.types';
import { LicenseStatus, Prisma } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { RobotLoginDto } from './auth.dto';
import { createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async loginUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (user.isLocked) {
      throw new ForbiddenException('Account is locked. Contact your administrator.');
    }

    if (!user.isSuperAdmin && !user.orgId) {
      throw new ForbiddenException('User has no organization assigned');
    }

    const payload: JwtPayload = {
      type: 'user',
      sub: user.id,
      orgId: user.orgId ?? null,
      isSuperAdmin: user.isSuperAdmin,
    };

    return {
      token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        orgId: user.orgId,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;

    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private digest(value: string | number): string {
    return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
  }

  private toStoredDeviceMetadata(dto: RobotLoginDto): Prisma.InputJsonObject {
    return {
      schemaVersion: 1,
      storage: 'sha256-digest',
      consent: {
        deviceMetadata: dto.deviceMetadataConsent,
      },
      identity: {
        manufacturerSha256: this.digest(dto.deviceMetadata.manufacturer),
        modelSha256: this.digest(dto.deviceMetadata.model),
        androidVersionSha256: this.digest(dto.deviceMetadata.androidVersion),
      },
      apiLevel: dto.deviceMetadata.apiLevel,
      appVersionName: dto.deviceMetadata.appVersionName,
      appVersionCode: dto.deviceMetadata.appVersionCode,
    };
  }

  private async recordRejectedRobotLogin(robot: { id: number; orgId: number }, reason: string) {
    await this.prisma.event.create({
      data: {
        orgId: robot.orgId,
        robotId: robot.id,
        type: 'ROBOT_LOGIN_REJECTED',
        payload: {
          reason,
          endpoint: 'robot.login',
        },
      },
    });
  }

  async loginRobot(input: RobotLoginDto) {
    const robot = await this.prisma.robot.findUnique({
      where: { licenseKey: input.licenseKey },
      include: { org: { select: { isActive: true } } },
    });
    if (!robot) {
      throw new UnauthorizedException('Invalid robot credentials');
    }

    if (robot.serialNumber !== input.serialNumber) {
      await this.recordRejectedRobotLogin(robot, 'SERIAL_MISMATCH');
      throw new UnauthorizedException('Invalid robot credentials');
    }

    if (!robot.org.isActive) {
      await this.recordRejectedRobotLogin(robot, 'ORG_INACTIVE');
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);

    // keep DB status updated (cheap + keeps sync consistent)
    if (robot.licenseStatus !== status) {
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: { licenseStatus: status },
      });
    }

    if (status === LicenseStatus.EXPIRED) {
      await this.recordRejectedRobotLogin(robot, 'LICENSE_EXPIRED');
      throw new DomainLockedException('LICENSE_EXPIRED', 'Robot license is expired');
    }

    if (status === LicenseStatus.REVOKED) {
      await this.recordRejectedRobotLogin(robot, 'LICENSE_REVOKED');
      throw new DomainLockedException('LICENSE_REVOKED', 'Robot license is revoked');
    }

    const deviceMetadata = this.toStoredDeviceMetadata(input);

    await this.prisma.robot.update({
      where: { id: robot.id },
      data: {
        lastSeenAt: new Date(),
        appVersion: input.deviceMetadata.appVersionName,
        deviceModel: null,
        deviceMetadata,
      },
    });

    const payload: JwtPayload = {
      type: 'robot',
      sub: robot.id,
      orgId: robot.orgId,
    };

    return {
      token: this.jwt.sign(payload),
      robot: {
        id: robot.id,
        orgId: robot.orgId,
        serialNumber: robot.serialNumber,
        name: robot.name,
      },
      license: {
        validFrom: robot.validFrom,
        validUntil: robot.validUntil,
        status,
        locked: false,
      },
    };
  }
}
