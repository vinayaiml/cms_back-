import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../../common/auth/jwt.types';
import { LicenseStatus, Prisma } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { RobotLoginDto } from './auth.dto';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthRateLimitService, AuthTooManyRequestsException } from './auth-rate-limit.service';
import { licenseFingerprint, verifyLicenseKey } from '../../common/security/license-secret';

const DEFAULT_ROBOT_ACCESS_TOKEN_EXPIRES_IN = '15m';
const DEFAULT_ROBOT_REFRESH_TOKEN_EXPIRES_IN = '7d';

type RobotTokenResponse = {
  token: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  refreshExpiresIn?: number;
  tokenType: 'Bearer';
  robot: {
    id: number;
    orgId: number;
    serialNumber: string;
    name: string | null;
  };
  license: {
    validFrom: Date;
    validUntil: Date;
    status: LicenseStatus;
    locked: false;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private rateLimit: AuthRateLimitService,
    private audit: AuditService,
  ) {}

  private safeHash(value: string | number | null | undefined) {
    return createHash('sha256').update(String(value ?? '').trim().toLowerCase()).digest('hex');
  }

  private rateLimitKey(kind: 'user' | 'robot', identifier: string, ip?: string) {
    return `auth:${kind}:${this.safeHash(identifier)}:${this.safeHash(ip || 'unknown')}`;
  }

  private async auditAuthFailure(input: {
    key: string;
    action: string;
    targetType: string;
    targetId: string;
    targetOrgId?: number | null;
    reason: string;
    endpoint: string;
    ip?: string;
  }) {
    if (!this.rateLimit.shouldAudit(input.key, input.reason)) return;

    await this.audit.recordBestEffort({
      actor: { userId: null, orgId: null, isSuperAdmin: false },
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetOrgId: input.targetOrgId ?? null,
      metadata: {
        reason: input.reason,
        endpoint: input.endpoint,
        ipSha256: this.safeHash(input.ip || 'unknown'),
      },
    });
  }

  private async auditUserFailure(key: string, email: string, reason: string, ip?: string, targetOrgId?: number | null) {
    await this.auditAuthFailure({
      key,
      action: 'auth.login_failed',
      targetType: 'user_auth',
      targetId: this.safeHash(email),
      targetOrgId,
      reason,
      endpoint: 'user.login',
      ip,
    });
  }

  private async auditRobotFailure(
    key: string,
    robot: { id: number; orgId: number } | null,
    licenseKey: string,
    reason: string,
    ip?: string,
  ) {
    await this.auditAuthFailure({
      key,
      action: 'robot.login_failed',
      targetType: 'robot_auth',
      targetId: robot ? String(robot.id) : this.safeHash(licenseKey),
      targetOrgId: robot?.orgId ?? null,
      reason,
      endpoint: 'robot.login',
      ip,
    });
  }

  private async rejectRateLimited(key: string, action: string, targetType: string, targetId: string, endpoint: string, ip?: string) {
    try {
      this.rateLimit.assertAllowed(key);
    } catch (error) {
      if (error instanceof AuthTooManyRequestsException) {
        await this.auditAuthFailure({
          key,
          action,
          targetType,
          targetId,
          reason: 'RATE_LIMITED',
          endpoint,
          ip,
        });
      }

      throw error;
    }
  }

  async loginUser(email: string, password: string, context: { ip?: string } = {}) {
    const rateKey = this.rateLimitKey('user', email, context.ip);
    await this.rejectRateLimited(
      rateKey,
      'auth.login_throttled',
      'user_auth',
      this.safeHash(email),
      'user.login',
      context.ip,
    );

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { org: { select: { isActive: true } } },
    });
    if (!user) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditUserFailure(rateKey, email, 'INVALID_CREDENTIALS', context.ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditUserFailure(rateKey, email, 'INVALID_CREDENTIALS', context.ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isLocked) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditUserFailure(rateKey, email, 'ACCOUNT_LOCKED', context.ip);
      throw new ForbiddenException('Account is locked. Contact your administrator.');
    }

    if (!user.isSuperAdmin && !user.orgId) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditUserFailure(rateKey, email, 'NO_ORG_SCOPE', context.ip);
      throw new ForbiddenException('User has no organization assigned');
    }

    if (!user.isSuperAdmin && !user.org?.isActive) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditUserFailure(rateKey, email, 'ORG_INACTIVE', context.ip, user.orgId);
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    const payload: JwtPayload = {
      type: 'user',
      sub: user.id,
      orgId: user.orgId ?? null,
      isSuperAdmin: user.isSuperAdmin,
    };

    this.rateLimit.recordSuccess(rateKey);

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
    return this.safeHash(value);
  }

  private toStoredDeviceMetadata(dto: RobotLoginDto): Prisma.InputJsonObject {
    return {
      schemaVersion: 1,
      storage: 'sha256-digest',
      consent: {
        deviceMetadata: dto.deviceMetadataConsent ?? true,
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

  private robotAccessTokenExpiresIn() {
    return process.env.ROBOT_ACCESS_TOKEN_EXPIRES_IN || DEFAULT_ROBOT_ACCESS_TOKEN_EXPIRES_IN;
  }

  private robotRefreshTokenExpiresIn() {
    return process.env.ROBOT_REFRESH_TOKEN_EXPIRES_IN || DEFAULT_ROBOT_REFRESH_TOKEN_EXPIRES_IN;
  }

  private durationToSeconds(value: string) {
    const match = value.trim().match(/^(\d+)([smhd])?$/);
    if (!match) return 900;

    const amount = Number(match[1]);
    const unit = match[2] || 's';
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };

    return amount * multipliers[unit];
  }

  private signRobotAccessToken(robot: { id: number; orgId: number }) {
    const payload: JwtPayload = {
      type: 'robot',
      tokenUse: 'access',
      sub: robot.id,
      orgId: robot.orgId,
    };

    return this.jwt.sign(payload, { expiresIn: this.robotAccessTokenExpiresIn() });
  }

  private signRobotRefreshToken(robot: { id: number; orgId: number }) {
    const payload: JwtPayload = {
      type: 'robot',
      tokenUse: 'refresh',
      sub: robot.id,
      orgId: robot.orgId,
    };

    return this.jwt.sign(payload, { expiresIn: this.robotRefreshTokenExpiresIn() });
  }

  private robotTokenResponse(robot: {
    id: number;
    orgId: number;
    serialNumber: string;
    name: string | null;
    validFrom: Date;
    validUntil: Date;
  }, status: LicenseStatus, includeRefreshToken: boolean): RobotTokenResponse {
    const accessToken = this.signRobotAccessToken(robot);
    const response: RobotTokenResponse = {
      token: accessToken,
      accessToken,
      expiresIn: this.durationToSeconds(this.robotAccessTokenExpiresIn()),
      tokenType: 'Bearer',
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

    if (includeRefreshToken) {
      response.refreshToken = this.signRobotRefreshToken(robot);
      response.refreshExpiresIn = this.durationToSeconds(this.robotRefreshTokenExpiresIn());
    }

    return response;
  }

  private async assertRobotCanUseTokens(robot: {
    id: number;
    orgId: number;
    validUntil: Date;
    revokedAt: Date | null;
    licenseStatus: LicenseStatus;
    org: { isActive: boolean };
  }) {
    if (!robot.org.isActive) {
      await this.recordRejectedRobotLogin(robot, 'ORG_INACTIVE');
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);

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

    return status;
  }

  async loginRobot(input: RobotLoginDto, context: { ip?: string } = {}) {
    const rateKey = this.rateLimitKey('robot', `${input.licenseKey}:${input.serialNumber}`, context.ip);
    await this.rejectRateLimited(
      rateKey,
      'robot.login_throttled',
      'robot_auth',
      this.safeHash(input.licenseKey),
      'robot.login',
      context.ip,
    );

    const inputLicenseFingerprint = licenseFingerprint(input.licenseKey);
    const robot = await this.prisma.robot.findFirst({
      where: {
        OR: [
          { licenseKeyFingerprint: inputLicenseFingerprint },
          { licenseKey: input.licenseKey },
        ],
      },
      include: { org: { select: { isActive: true } } },
    });
    if (!robot) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditRobotFailure(rateKey, null, input.licenseKey, 'INVALID_CREDENTIALS', context.ip);
      throw new UnauthorizedException('Invalid robot credentials');
    }

    if (robot.licenseKeyFingerprint && !verifyLicenseKey(input.licenseKey, robot.licenseKeyFingerprint)) {
      this.rateLimit.recordFailure(rateKey);
      await this.auditRobotFailure(rateKey, robot, input.licenseKey, 'INVALID_CREDENTIALS', context.ip);
      throw new UnauthorizedException('Invalid robot credentials');
    }

    if (robot.serialNumber !== input.serialNumber) {
      this.rateLimit.recordFailure(rateKey);
      await this.recordRejectedRobotLogin(robot, 'SERIAL_MISMATCH');
      await this.auditRobotFailure(rateKey, robot, input.licenseKey, 'SERIAL_MISMATCH', context.ip);
      throw new UnauthorizedException('Invalid robot credentials');
    }

    let status: LicenseStatus;
    try {
      status = await this.assertRobotCanUseTokens(robot);
    } catch (error) {
      this.rateLimit.recordFailure(rateKey);
      const code = error instanceof DomainLockedException ? error.getResponse() : null;
      const reason =
        typeof code === 'object' && code && 'error' in code && typeof (code as any).error?.code === 'string'
          ? (code as any).error.code
          : 'ROBOT_LOCKED';
      await this.auditRobotFailure(rateKey, robot, input.licenseKey, reason, context.ip);
      throw error;
    }

    const deviceMetadata = this.toStoredDeviceMetadata(input);

    await this.prisma.robot.update({
      where: { id: robot.id },
      data: {
        lastSeenAt: new Date(),
        appVersion: input.deviceMetadata.appVersionName,
        deviceModel: input.deviceMetadata.model,
        deviceMetadata,
      },
    });

    this.rateLimit.recordSuccess(rateKey);

    return this.robotTokenResponse(robot, status, true);
  }

  async refreshRobotToken(refreshToken: string) {
    let payload: JwtPayload;

    try {
      payload = this.jwt.verify<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'robot' || payload.tokenUse !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: payload.sub },
      include: { org: { select: { isActive: true } } },
    });

    if (!robot || robot.orgId !== payload.orgId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const status = await this.assertRobotCanUseTokens(robot);

    return this.robotTokenResponse(robot, status, false);
  }
}
