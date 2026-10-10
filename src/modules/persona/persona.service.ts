import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LicenseStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActor } from '../audit/audit.types';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import {
  EffectivePersonaResponse,
  UpsertOrganizationPersonaDto,
  UpsertRobotPersonaOverrideDto,
} from './persona.dto';

const DEFAULT_PERSONA_NAME = 'WhizRobot Assistant';
const DEFAULT_GREETING_TEXT = 'Hello! Welcome to our organization.';
const DEFAULT_SPEECH_GREETING = 'Hello! Welcome to our organization.';
const DEFAULT_VOICE_STYLE = 'standard';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_TONE = 'friendly';

@Injectable()
export class PersonaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private assertOrgAccess(orgId: number, actor: AuditActor) {
    if (!actor.isSuperAdmin && actor.orgId !== orgId) {
      throw new ForbiddenException('Tenant access forbidden');
    }
  }

  async getOrganizationPersona(orgId: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const config = await this.prisma.organizationPersonaConfig.findUnique({
      where: { orgId },
    });

    if (!config) {
      return {
        id: null,
        orgId,
        personaName: DEFAULT_PERSONA_NAME,
        personaPrompt: null,
        greetingText: DEFAULT_GREETING_TEXT,
        speechGreeting: DEFAULT_SPEECH_GREETING,
        voiceStyle: DEFAULT_VOICE_STYLE,
        language: DEFAULT_LANGUAGE,
        tone: DEFAULT_TONE,
        version: 1,
        isPublished: true,
      };
    }

    return config;
  }

  async upsertOrganizationPersona(
    orgId: number,
    dto: UpsertOrganizationPersonaDto,
    actor: AuditActor,
  ) {
    this.assertOrgAccess(orgId, actor);

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const existing = await this.prisma.organizationPersonaConfig.findUnique({
      where: { orgId },
    });

    const version = existing ? existing.version + 1 : 1;

    const saved = await this.prisma.$transaction(async (tx) => {
      const config = await tx.organizationPersonaConfig.upsert({
        where: { orgId },
        create: {
          orgId,
          personaName: dto.personaName ?? DEFAULT_PERSONA_NAME,
          personaPrompt: dto.personaPrompt,
          greetingText: dto.greetingText ?? DEFAULT_GREETING_TEXT,
          speechGreeting: dto.speechGreeting ?? DEFAULT_SPEECH_GREETING,
          voiceStyle: dto.voiceStyle ?? DEFAULT_VOICE_STYLE,
          language: dto.language ?? DEFAULT_LANGUAGE,
          tone: dto.tone ?? DEFAULT_TONE,
          isPublished: dto.isPublished ?? true,
          version: 1,
        },
        update: {
          ...(dto.personaName !== undefined ? { personaName: dto.personaName } : {}),
          ...(dto.personaPrompt !== undefined ? { personaPrompt: dto.personaPrompt } : {}),
          ...(dto.greetingText !== undefined ? { greetingText: dto.greetingText } : {}),
          ...(dto.speechGreeting !== undefined ? { speechGreeting: dto.speechGreeting } : {}),
          ...(dto.voiceStyle !== undefined ? { voiceStyle: dto.voiceStyle } : {}),
          ...(dto.language !== undefined ? { language: dto.language } : {}),
          ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
          version,
        },
      });

      // Increment tenantVersion to invalidate robot sync/manifest cache
      await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
      });

      return config;
    });

    await this.auditService.recordBestEffort({
      actor,
      action: 'ORGANIZATION_PERSONA_CONFIG_UPDATED',
      targetType: 'ORGANIZATION',
      targetId: String(orgId),
      targetOrgId: orgId,
      metadata: {
        version: saved.version,
        personaName: saved.personaName,
        tone: saved.tone,
      },
    });

    return saved;
  }

  async getRobotPersonaOverride(orgId: number, robotId: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot || robot.orgId !== orgId) {
      throw new ForbiddenException('Robot does not belong to organization');
    }

    return this.prisma.robotPersonaConfig.findUnique({
      where: { robotId },
    });
  }

  async upsertRobotPersonaOverride(
    orgId: number,
    robotId: number,
    dto: UpsertRobotPersonaOverrideDto,
    actor: AuditActor,
  ) {
    this.assertOrgAccess(orgId, actor);

    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot || robot.orgId !== orgId) {
      throw new ForbiddenException('Robot does not belong to organization');
    }

    const existing = await this.prisma.robotPersonaConfig.findUnique({
      where: { robotId },
    });

    const version = existing ? existing.version + 1 : 1;

    const saved = await this.prisma.robotPersonaConfig.upsert({
      where: { robotId },
      create: {
        orgId,
        robotId,
        personaName: dto.personaName,
        personaPrompt: dto.personaPrompt,
        greetingText: dto.greetingText,
        speechGreeting: dto.speechGreeting,
        voiceStyle: dto.voiceStyle,
        language: dto.language,
        tone: dto.tone,
        isPublished: dto.isPublished ?? true,
        version: 1,
      },
      update: {
        ...(dto.personaName !== undefined ? { personaName: dto.personaName } : {}),
        ...(dto.personaPrompt !== undefined ? { personaPrompt: dto.personaPrompt } : {}),
        ...(dto.greetingText !== undefined ? { greetingText: dto.greetingText } : {}),
        ...(dto.speechGreeting !== undefined ? { speechGreeting: dto.speechGreeting } : {}),
        ...(dto.voiceStyle !== undefined ? { voiceStyle: dto.voiceStyle } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
        ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
        version,
      },
    });

    await this.auditService.recordBestEffort({
      actor,
      action: 'ROBOT_PERSONA_OVERRIDE_UPDATED',
      targetType: 'ROBOT',
      targetId: String(robotId),
      targetOrgId: orgId,
      metadata: {
        robotId,
        version: saved.version,
      },
    });

    return saved;
  }

  async deleteRobotPersonaOverride(orgId: number, robotId: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot || robot.orgId !== orgId) {
      throw new ForbiddenException('Robot does not belong to organization');
    }

    const existing = await this.prisma.robotPersonaConfig.findUnique({
      where: { robotId },
    });

    if (existing) {
      await this.prisma.robotPersonaConfig.delete({ where: { robotId } });

      await this.auditService.recordBestEffort({
        actor,
        action: 'ROBOT_PERSONA_OVERRIDE_DELETED',
        targetType: 'ROBOT',
        targetId: String(robotId),
        targetOrgId: orgId,
      });
    }

    return { success: true };
  }

  async resolveEffectivePersona(
    orgId: number,
    robotId: number,
  ): Promise<EffectivePersonaResponse> {
    const now = new Date();

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: {
        org: true,
        personaConfig: true,
      },
    });

    if (!robot) {
      throw new DomainLockedException('ROBOT_NOT_FOUND', 'Robot identity is invalid');
    }

    if (robot.orgId !== orgId) {
      throw new ForbiddenException('Robot does not belong to organization');
    }

    if (!robot.org || !robot.org.isActive) {
      throw new DomainLockedException('ORG_INACTIVE', 'Robot organization is inactive');
    }

    if (
      robot.licenseStatus !== LicenseStatus.ACTIVE ||
      robot.validUntil < now ||
      robot.revokedAt !== null
    ) {
      throw new DomainLockedException('LICENSE_INACTIVE', 'Robot license is not active');
    }

    const orgConfig = await this.prisma.organizationPersonaConfig.findUnique({
      where: { orgId },
    });

    const orgBaseline = {
      personaName: orgConfig?.personaName || DEFAULT_PERSONA_NAME,
      personaPrompt: orgConfig?.personaPrompt || null,
      greetingText: orgConfig?.greetingText || DEFAULT_GREETING_TEXT,
      speechGreeting: orgConfig?.speechGreeting || DEFAULT_SPEECH_GREETING,
      voiceStyle: orgConfig?.voiceStyle || DEFAULT_VOICE_STYLE,
      language: orgConfig?.language || DEFAULT_LANGUAGE,
      tone: orgConfig?.tone || DEFAULT_TONE,
      version: orgConfig?.version || 1,
    };

    const override = robot.personaConfig;
    const isOverridden = Boolean(override && override.isPublished);

    const personaName = (isOverridden && override?.personaName) || orgBaseline.personaName;
    const personaPrompt = isOverridden && override?.personaPrompt !== null && override?.personaPrompt !== undefined
      ? override.personaPrompt
      : orgBaseline.personaPrompt;
    const greetingText = (isOverridden && override?.greetingText) || orgBaseline.greetingText;
    const speechGreeting = (isOverridden && override?.speechGreeting) || orgBaseline.speechGreeting;
    const voiceStyle = (isOverridden && override?.voiceStyle) || orgBaseline.voiceStyle;
    const language = (isOverridden && override?.language) || orgBaseline.language;
    const tone = (isOverridden && override?.tone) || orgBaseline.tone;
    const version = orgBaseline.version + (isOverridden ? override!.version : 0);
    const configVersion = `persona-org-${orgId}-r-${robotId}-v${version}`;

    return {
      schemaVersion: 1,
      configVersion,
      orgId,
      robotId,
      personaName,
      personaPrompt,
      greetingText,
      speechGreeting,
      voiceStyle,
      language,
      tone,
      version,
      isOverridden,
      publishedAt: (override?.updatedAt || orgConfig?.updatedAt || robot.updatedAt).toISOString(),
    };
  }
}
