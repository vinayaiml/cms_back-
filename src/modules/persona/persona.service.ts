import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { LicenseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActor } from '../audit/audit.types';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import {
  EffectivePersonaResponse,
  UpsertOrganizationPersonaDto,
  UpsertRobotPersonaOverrideDto,
} from './persona.dto';
import { validateNoProhibitedSecretsOrPii } from '../conversation-context/context-validation.util';
import { ConversationPublicationService } from '../conversation-publication/conversation-publication.service';

const DEFAULT_PERSONA_NAME = 'WhizRobot Assistant';
const DEFAULT_GREETING_TEXT = 'Hello! Welcome to our organization.';
const DEFAULT_SPEECH_GREETING = 'Hello! Welcome to our organization.';
const DEFAULT_VOICE_STYLE = 'standard';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_TONE = 'friendly';
const DEFAULT_SPEECH_SPEED = 1.0;
const DEFAULT_SESSION_MAX_SECONDS = 300;
const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 60;
const DEFAULT_COOLDOWN_SECONDS = 5;
const DEFAULT_DAILY_SESSION_LIMIT = 1000;
const DEFAULT_SUPPORTED_LANGUAGES = ['en-US'];

function normalizeSupportedLanguages(
  val: string[] | string | undefined | null,
): string | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null as any;
  if (Array.isArray(val)) {
    return val.map((s) => s.trim()).filter(Boolean).join(',');
  }
  return val.trim();
}

function parseSupportedLanguages(
  val: string | null | undefined,
  defaultLang = DEFAULT_LANGUAGE,
): string[] {
  if (!val) return [defaultLang];
  const list = val.split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.includes(defaultLang)) {
    list.unshift(defaultLang);
  }
  return list.length > 0 ? list : [defaultLang];
}

function validatePolicyAndSecretRanges(
  dto: UpsertOrganizationPersonaDto | UpsertRobotPersonaOverrideDto,
): void {
  // Validate secrets / credentials / PII in string inputs
  validateNoProhibitedSecretsOrPii(dto.personaName, 'personaName');
  validateNoProhibitedSecretsOrPii(dto.personaPrompt, 'personaPrompt');
  validateNoProhibitedSecretsOrPii(dto.greetingText, 'greetingText');
  validateNoProhibitedSecretsOrPii(dto.speechGreeting, 'speechGreeting');
  validateNoProhibitedSecretsOrPii(dto.voiceStyle, 'voiceStyle');
  validateNoProhibitedSecretsOrPii(dto.language, 'language');
  validateNoProhibitedSecretsOrPii(dto.tone, 'tone');

  if (dto.supportedLanguages !== undefined && dto.supportedLanguages !== null) {
    const raw = Array.isArray(dto.supportedLanguages)
      ? dto.supportedLanguages.join(',')
      : dto.supportedLanguages;
    validateNoProhibitedSecretsOrPii(raw, 'supportedLanguages');
  }

  // Safe range validation
  if (dto.speechSpeed !== undefined && dto.speechSpeed !== null) {
    if (dto.speechSpeed < 0.5 || dto.speechSpeed > 2.0) {
      throw new BadRequestException('speechSpeed must be between 0.5 and 2.0');
    }
  }

  if (dto.sessionMaxSeconds !== undefined && dto.sessionMaxSeconds !== null) {
    if (dto.sessionMaxSeconds < 30 || dto.sessionMaxSeconds > 3600) {
      throw new BadRequestException('sessionMaxSeconds must be between 30 and 3600');
    }
  }

  if (dto.sessionIdleTimeoutSeconds !== undefined && dto.sessionIdleTimeoutSeconds !== null) {
    if (dto.sessionIdleTimeoutSeconds < 10 || dto.sessionIdleTimeoutSeconds > 600) {
      throw new BadRequestException('sessionIdleTimeoutSeconds must be between 10 and 600');
    }
  }

  if (dto.cooldownSeconds !== undefined && dto.cooldownSeconds !== null) {
    if (dto.cooldownSeconds < 0 || dto.cooldownSeconds > 300) {
      throw new BadRequestException('cooldownSeconds must be between 0 and 300');
    }
  }

  if (dto.dailySessionLimit !== undefined && dto.dailySessionLimit !== null) {
    if (dto.dailySessionLimit < 1 || dto.dailySessionLimit > 100000) {
      throw new BadRequestException('dailySessionLimit must be between 1 and 100000');
    }
  }

  if (dto.language !== undefined && dto.language !== null) {
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/.test(dto.language)) {
      throw new BadRequestException('Invalid language code');
    }
  }
}

@Injectable()
export class PersonaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Optional()
    private readonly publicationService?: ConversationPublicationService,
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
        speechSpeed: DEFAULT_SPEECH_SPEED,
        sessionMaxSeconds: DEFAULT_SESSION_MAX_SECONDS,
        sessionIdleTimeoutSeconds: DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
        cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
        dailySessionLimit: DEFAULT_DAILY_SESSION_LIMIT,
        supportedLanguages: DEFAULT_SUPPORTED_LANGUAGES,
        version: 1,
        isPublished: true,
      };
    }

    return {
      ...config,
      supportedLanguages: parseSupportedLanguages(config.supportedLanguages, config.language),
    };
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

    validatePolicyAndSecretRanges(dto);

    const existing = await this.prisma.organizationPersonaConfig.findUnique({
      where: { orgId },
    });

    const version = existing ? existing.version + 1 : 1;
    const normalizedSupported = normalizeSupportedLanguages(dto.supportedLanguages);

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
          speechSpeed: dto.speechSpeed ?? DEFAULT_SPEECH_SPEED,
          sessionMaxSeconds: dto.sessionMaxSeconds ?? DEFAULT_SESSION_MAX_SECONDS,
          sessionIdleTimeoutSeconds:
            dto.sessionIdleTimeoutSeconds ?? DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
          cooldownSeconds: dto.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
          dailySessionLimit: dto.dailySessionLimit ?? DEFAULT_DAILY_SESSION_LIMIT,
          supportedLanguages: normalizedSupported ?? DEFAULT_LANGUAGE,
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
          ...(dto.speechSpeed !== undefined ? { speechSpeed: dto.speechSpeed } : {}),
          ...(dto.sessionMaxSeconds !== undefined ? { sessionMaxSeconds: dto.sessionMaxSeconds } : {}),
          ...(dto.sessionIdleTimeoutSeconds !== undefined
            ? { sessionIdleTimeoutSeconds: dto.sessionIdleTimeoutSeconds }
            : {}),
          ...(dto.cooldownSeconds !== undefined ? { cooldownSeconds: dto.cooldownSeconds } : {}),
          ...(dto.dailySessionLimit !== undefined ? { dailySessionLimit: dto.dailySessionLimit } : {}),
          ...(normalizedSupported !== undefined ? { supportedLanguages: normalizedSupported } : {}),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
          version,
        },
      });

      // Increment tenantVersion to invalidate robot sync/manifest cache
      await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
      });

      if (config.isPublished && this.publicationService) {
        await this.publicationService.recordRevision(tx, {
          orgId,
          scope: 'organization',
          sourceType: 'organization_persona',
          sourceId: config.id,
          version: config.version,
          previousVersion: existing?.version ?? null,
          snapshot: this.personaSnapshot(config) as Prisma.InputJsonValue,
          actor,
        });
      }

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
        isPublished: saved.isPublished,
        changedFields: Object.keys(dto),
      },
    });

    return {
      ...saved,
      supportedLanguages: parseSupportedLanguages(saved.supportedLanguages, saved.language),
    };
  }

  async getRobotPersonaOverride(orgId: number, robotId: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot || robot.orgId !== orgId) {
      throw new ForbiddenException('Robot does not belong to organization');
    }

    const config = await this.prisma.robotPersonaConfig.findUnique({
      where: { robotId },
    });

    if (!config) return null;

    return {
      ...config,
      supportedLanguages: config.supportedLanguages
        ? parseSupportedLanguages(config.supportedLanguages, config.language || DEFAULT_LANGUAGE)
        : null,
    };
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

    validatePolicyAndSecretRanges(dto);

    const existing = await this.prisma.robotPersonaConfig.findUnique({
      where: { robotId },
    });

    const version = existing ? existing.version + 1 : 1;
    const normalizedSupported = normalizeSupportedLanguages(dto.supportedLanguages);

    const saved = await this.prisma.$transaction(async (tx) => {
      const config = await tx.robotPersonaConfig.upsert({
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
          speechSpeed: dto.speechSpeed,
          sessionMaxSeconds: dto.sessionMaxSeconds,
          sessionIdleTimeoutSeconds: dto.sessionIdleTimeoutSeconds,
          cooldownSeconds: dto.cooldownSeconds,
          dailySessionLimit: dto.dailySessionLimit,
          supportedLanguages: normalizedSupported,
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
          ...(dto.speechSpeed !== undefined ? { speechSpeed: dto.speechSpeed } : {}),
          ...(dto.sessionMaxSeconds !== undefined ? { sessionMaxSeconds: dto.sessionMaxSeconds } : {}),
          ...(dto.sessionIdleTimeoutSeconds !== undefined
            ? { sessionIdleTimeoutSeconds: dto.sessionIdleTimeoutSeconds }
            : {}),
          ...(dto.cooldownSeconds !== undefined ? { cooldownSeconds: dto.cooldownSeconds } : {}),
          ...(dto.dailySessionLimit !== undefined ? { dailySessionLimit: dto.dailySessionLimit } : {}),
          ...(normalizedSupported !== undefined ? { supportedLanguages: normalizedSupported } : {}),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
          version,
        },
      });

      // Increment tenantVersion to invalidate robot sync/manifest cache
      await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
      });

      if (config.isPublished && this.publicationService) {
        await this.publicationService.recordRevision(tx, {
          orgId,
          robotId,
          scope: 'robot',
          sourceType: 'robot_persona',
          sourceId: config.id,
          version: config.version,
          previousVersion: existing?.version ?? null,
          snapshot: this.robotPersonaSnapshot(config) as Prisma.InputJsonValue,
          actor,
        });
      }

      return config;
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
        changedFields: Object.keys(dto),
      },
    });

    return {
      ...saved,
      supportedLanguages: saved.supportedLanguages
        ? parseSupportedLanguages(saved.supportedLanguages, saved.language || DEFAULT_LANGUAGE)
        : null,
    };
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
      await this.prisma.$transaction(async (tx) => {
        await tx.robotPersonaConfig.delete({ where: { robotId } });
        await tx.organization.update({
          where: { id: orgId },
          data: { tenantVersion: { increment: 1 } },
        });
      });

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

  private personaSnapshot(config: {
    personaName: string;
    personaPrompt: string | null;
    greetingText: string;
    speechGreeting: string;
    voiceStyle: string;
    language: string;
    tone: string;
    speechSpeed: number;
    sessionMaxSeconds: number;
    sessionIdleTimeoutSeconds: number;
    cooldownSeconds: number;
    dailySessionLimit: number;
    supportedLanguages: string;
  }) {
    return {
      personaName: config.personaName,
      personaPrompt: config.personaPrompt,
      greetingText: config.greetingText,
      speechGreeting: config.speechGreeting,
      voiceStyle: config.voiceStyle,
      language: config.language,
      tone: config.tone,
      speechSpeed: config.speechSpeed,
      sessionMaxSeconds: config.sessionMaxSeconds,
      sessionIdleTimeoutSeconds: config.sessionIdleTimeoutSeconds,
      cooldownSeconds: config.cooldownSeconds,
      dailySessionLimit: config.dailySessionLimit,
      supportedLanguages: config.supportedLanguages,
    };
  }

  private robotPersonaSnapshot(config: {
    personaName: string | null;
    personaPrompt: string | null;
    greetingText: string | null;
    speechGreeting: string | null;
    voiceStyle: string | null;
    language: string | null;
    tone: string | null;
    speechSpeed: number | null;
    sessionMaxSeconds: number | null;
    sessionIdleTimeoutSeconds: number | null;
    cooldownSeconds: number | null;
    dailySessionLimit: number | null;
    supportedLanguages: string | null;
  }) {
    return {
      personaName: config.personaName,
      personaPrompt: config.personaPrompt,
      greetingText: config.greetingText,
      speechGreeting: config.speechGreeting,
      voiceStyle: config.voiceStyle,
      language: config.language,
      tone: config.tone,
      speechSpeed: config.speechSpeed,
      sessionMaxSeconds: config.sessionMaxSeconds,
      sessionIdleTimeoutSeconds: config.sessionIdleTimeoutSeconds,
      cooldownSeconds: config.cooldownSeconds,
      dailySessionLimit: config.dailySessionLimit,
      supportedLanguages: config.supportedLanguages,
    };
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
      speechSpeed: orgConfig?.speechSpeed ?? DEFAULT_SPEECH_SPEED,
      sessionMaxSeconds: orgConfig?.sessionMaxSeconds ?? DEFAULT_SESSION_MAX_SECONDS,
      sessionIdleTimeoutSeconds:
        orgConfig?.sessionIdleTimeoutSeconds ?? DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
      cooldownSeconds: orgConfig?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
      dailySessionLimit: orgConfig?.dailySessionLimit ?? DEFAULT_DAILY_SESSION_LIMIT,
      supportedLanguages: parseSupportedLanguages(
        orgConfig?.supportedLanguages,
        orgConfig?.language || DEFAULT_LANGUAGE,
      ),
      version: orgConfig?.version || 1,
    };

    const override = robot.personaConfig;
    const isOverridden = Boolean(override && override.isPublished);

    const personaName = (isOverridden && override?.personaName) || orgBaseline.personaName;
    const personaPrompt =
      isOverridden && override?.personaPrompt !== null && override?.personaPrompt !== undefined
        ? override.personaPrompt
        : orgBaseline.personaPrompt;
    const greetingText = (isOverridden && override?.greetingText) || orgBaseline.greetingText;
    const speechGreeting =
      (isOverridden && override?.speechGreeting) || orgBaseline.speechGreeting;
    const voiceStyle = (isOverridden && override?.voiceStyle) || orgBaseline.voiceStyle;
    const language = (isOverridden && override?.language) || orgBaseline.language;
    const tone = (isOverridden && override?.tone) || orgBaseline.tone;

    // Policy overrides (robot override > org baseline > system default)
    const speechSpeed =
      isOverridden && override?.speechSpeed != null
        ? override.speechSpeed
        : orgBaseline.speechSpeed;

    const sessionMaxSeconds =
      isOverridden && override?.sessionMaxSeconds != null
        ? override.sessionMaxSeconds
        : orgBaseline.sessionMaxSeconds;

    const sessionIdleTimeoutSeconds =
      isOverridden && override?.sessionIdleTimeoutSeconds != null
        ? override.sessionIdleTimeoutSeconds
        : orgBaseline.sessionIdleTimeoutSeconds;

    const cooldownSeconds =
      isOverridden && override?.cooldownSeconds != null
        ? override.cooldownSeconds
        : orgBaseline.cooldownSeconds;

    const dailySessionLimit =
      isOverridden && override?.dailySessionLimit != null
        ? override.dailySessionLimit
        : orgBaseline.dailySessionLimit;

    const supportedLanguages =
      isOverridden && override?.supportedLanguages
        ? parseSupportedLanguages(override.supportedLanguages, language)
        : orgBaseline.supportedLanguages;

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
      speechSpeed,
      sessionMaxSeconds,
      sessionIdleTimeoutSeconds,
      cooldownSeconds,
      dailySessionLimit,
      supportedLanguages,
      version,
      isOverridden,
      publishedAt: (override?.updatedAt || orgConfig?.updatedAt || robot.updatedAt).toISOString(),
    };
  }
}
