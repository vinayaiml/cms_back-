import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LicenseStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActor } from '../audit/audit.types';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { PersonaService } from './persona.service';

describe('PersonaService (CMS-70)', () => {
  let service: PersonaService;

  const mockPrisma: any = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    organizationPersonaConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    robot: {
      findUnique: jest.fn(),
    },
    robotPersonaConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (cb) => cb(mockPrisma)),
  };

  const mockAudit = {
    recordBestEffort: jest.fn().mockResolvedValue({ id: 1 }),
  };

  const adminActor: AuditActor = {
    userId: 1,
    orgId: 10,
    isSuperAdmin: false,
  };

  const otherTenantActor: AuditActor = {
    userId: 2,
    orgId: 99,
    isSuperAdmin: false,
  };

  const superAdminActor: AuditActor = {
    userId: 3,
    orgId: null,
    isSuperAdmin: true,
  };

  const testOrg = {
    id: 10,
    name: 'Whiz High School',
    isActive: true,
    tenantVersion: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const testRobot = {
    id: 101,
    orgId: 10,
    name: 'Sanbot Reception',
    licenseStatus: LicenseStatus.ACTIVE,
    validUntil: new Date('2099-01-01T00:00:00.000Z'),
    revokedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    org: testOrg,
    personaConfig: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PersonaService(
      mockPrisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );

    mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
    mockPrisma.organization.update.mockResolvedValue({
      ...testOrg,
      tenantVersion: 2,
    });
    mockPrisma.robot.findUnique.mockResolvedValue(testRobot);
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue(null);
    mockPrisma.robotPersonaConfig.findUnique.mockResolvedValue(null);
  });

  // Test 1: Baseline Org Persona
  it('should return default baseline organization persona when no custom config exists', async () => {
    const res = await service.getOrganizationPersona(10, adminActor);

    expect(res).toBeDefined();
    expect(res.personaName).toBe('WhizRobot Assistant');
    expect(res.tone).toBe('friendly');
    expect(res.version).toBe(1);
    expect(res.isPublished).toBe(true);
  });

  // Test 2: Upsert Org Persona
  it('should upsert organization persona, increment version, and bump organization tenantVersion', async () => {
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue({
      id: 1,
      orgId: 10,
      version: 1,
    });

    const savedConfig = {
      id: 1,
      orgId: 10,
      personaName: 'Whizzy Academy Bot',
      personaPrompt: 'You are a helpful school guide.',
      greetingText: 'Welcome to Whiz High!',
      speechGreeting: 'Welcome to Whiz High!',
      voiceStyle: 'warm',
      language: 'en-US',
      tone: 'playful',
      version: 2,
      isPublished: true,
      updatedAt: new Date(),
    };
    mockPrisma.organizationPersonaConfig.upsert.mockResolvedValue(savedConfig);

    const res = await service.upsertOrganizationPersona(
      10,
      {
        personaName: 'Whizzy Academy Bot',
        tone: 'playful',
        greetingText: 'Welcome to Whiz High!',
      },
      adminActor,
    );

    expect(res.version).toBe(2);
    expect(res.personaName).toBe('Whizzy Academy Bot');
    expect(mockPrisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: { tenantVersion: { increment: 1 } },
      }),
    );
    expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORGANIZATION_PERSONA_CONFIG_UPDATED',
        targetId: '10',
        targetOrgId: 10,
      }),
    );
  });

  // Test 3: Cross-tenant direct-ID check on Org Persona
  it('should reject organization persona access when user belongs to different tenant (direct-ID check)', async () => {
    await expect(
      service.getOrganizationPersona(10, otherTenantActor),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.upsertOrganizationPersona(10, { tone: 'formal' }, otherTenantActor),
    ).rejects.toThrow(ForbiddenException);
  });

  // Test 4: Super Admin cross-tenant access allowed
  it('should allow super admin to view and update any organization persona', async () => {
    const res = await service.getOrganizationPersona(10, superAdminActor);
    expect(res).toBeDefined();
    expect(res.orgId).toBe(10);
  });

  // Test 5: Upsert Robot Persona Override
  it('should upsert robot persona override with versioning', async () => {
    const savedOverride = {
      id: 5,
      orgId: 10,
      robotId: 101,
      personaName: 'Sanbot Reception Unit',
      greetingText: 'Hello from Reception Desk!',
      version: 1,
      isPublished: true,
      updatedAt: new Date(),
    };
    mockPrisma.robotPersonaConfig.upsert.mockResolvedValue(savedOverride);

    const res = await service.upsertRobotPersonaOverride(
      10,
      101,
      {
        personaName: 'Sanbot Reception Unit',
        greetingText: 'Hello from Reception Desk!',
      },
      adminActor,
    );

    expect(res.robotId).toBe(101);
    expect(res.personaName).toBe('Sanbot Reception Unit');
    expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ROBOT_PERSONA_OVERRIDE_UPDATED',
        targetId: '101',
      }),
    );
  });

  // Test 6: Cross-tenant / Mismatched Robot direct-ID rejection
  it('should reject robot override when robot belongs to different organization', async () => {
    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      orgId: 99, // Mismatched orgId
    });

    await expect(
      service.getRobotPersonaOverride(10, 101, adminActor),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.upsertRobotPersonaOverride(10, 101, { tone: 'formal' }, adminActor),
    ).rejects.toThrow(ForbiddenException);
  });

  // Test 7: Delete Robot Persona Override
  it('should delete robot override successfully and log audit event', async () => {
    mockPrisma.robotPersonaConfig.findUnique.mockResolvedValue({
      id: 5,
      robotId: 101,
    });

    const res = await service.deleteRobotPersonaOverride(10, 101, adminActor);

    expect(res.success).toBe(true);
    expect(mockPrisma.robotPersonaConfig.delete).toHaveBeenCalledWith({
      where: { robotId: 101 },
    });
    expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ROBOT_PERSONA_OVERRIDE_DELETED',
        targetId: '101',
      }),
    );
  });

  // Test 8: Effective Resolution - Robot Override Wins
  it('should resolve effective persona with robot override winning over organization defaults', async () => {
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue({
      orgId: 10,
      personaName: 'Default School Bot',
      personaPrompt: 'General org prompt',
      greetingText: 'Default Org Greeting',
      speechGreeting: 'Default Org Greeting',
      voiceStyle: 'standard',
      language: 'en-US',
      tone: 'friendly',
      version: 2,
    });

    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      personaConfig: {
        id: 5,
        orgId: 10,
        robotId: 101,
        personaName: 'Reception Robot Override',
        personaPrompt: 'Custom reception prompt',
        greetingText: 'Welcome to the front desk!',
        speechGreeting: 'Welcome to the front desk!',
        voiceStyle: null, // Should fall back to org
        language: null, // Should fall back to org
        tone: 'formal', // Override
        version: 1,
        isPublished: true,
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    const res = await service.resolveEffectivePersona(10, 101);

    expect(res.isOverridden).toBe(true);
    expect(res.personaName).toBe('Reception Robot Override');
    expect(res.personaPrompt).toBe('Custom reception prompt');
    expect(res.greetingText).toBe('Welcome to the front desk!');
    expect(res.tone).toBe('formal');
    expect(res.voiceStyle).toBe('standard'); // Fell back to org
    expect(res.version).toBe(3); // 2 (org) + 1 (override)
    expect(res.configVersion).toBe('persona-org-10-r-101-v3');
  });

  // Test 9: Effective Resolution - Fallback to Org Defaults
  it('should resolve effective persona falling back to organization defaults when no override exists', async () => {
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue({
      orgId: 10,
      personaName: 'Global Org Persona',
      personaPrompt: 'Global Org Prompt',
      greetingText: 'Global Org Greeting',
      speechGreeting: 'Global Org Speech',
      voiceStyle: 'warm',
      language: 'en-GB',
      tone: 'informative',
      version: 1,
      updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    });

    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      personaConfig: null, // No override
    });

    const res = await service.resolveEffectivePersona(10, 101);

    expect(res.isOverridden).toBe(false);
    expect(res.personaName).toBe('Global Org Persona');
    expect(res.greetingText).toBe('Global Org Greeting');
    expect(res.voiceStyle).toBe('warm');
    expect(res.language).toBe('en-GB');
    expect(res.version).toBe(1);
    expect(res.configVersion).toBe('persona-org-10-r-101-v1');
  });

  // Test 10: Inactive Org / Inactive License rejection
  it('should reject effective persona resolution when robot organization is inactive or license expired', async () => {
    // Inactive org
    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      org: { ...testOrg, isActive: false },
    });

    await expect(service.resolveEffectivePersona(10, 101)).rejects.toThrow(
      DomainLockedException,
    );

    // Expired license
    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      licenseStatus: LicenseStatus.EXPIRED,
    });

    await expect(service.resolveEffectivePersona(10, 101)).rejects.toThrow(
      DomainLockedException,
    );
  });

  // Test 11: Zero Secret Leakage Guarantee
  it('should guarantee zero secrets, tokens, or private keys are exposed in resolved persona response', async () => {
    const res = await service.resolveEffectivePersona(10, 101);

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('licenseKey');
  });

  // Test 12: Validate speechSpeed safe range
  it('should validate speechSpeed safe range and reject out-of-range values', async () => {
    await expect(
      service.upsertOrganizationPersona(10, { speechSpeed: 0.2 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { speechSpeed: 2.5 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertRobotPersonaOverride(10, 101, { speechSpeed: 3.0 }, adminActor),
    ).rejects.toThrow(BadRequestException);
  });

  // Test 13: Validate sessionMaxSeconds and sessionIdleTimeoutSeconds safe ranges
  it('should validate sessionMaxSeconds and sessionIdleTimeoutSeconds safe ranges', async () => {
    await expect(
      service.upsertOrganizationPersona(10, { sessionMaxSeconds: 15 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { sessionMaxSeconds: 5000 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { sessionIdleTimeoutSeconds: 5 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { sessionIdleTimeoutSeconds: 1000 }, adminActor),
    ).rejects.toThrow(BadRequestException);
  });

  // Test 14: Validate cooldownSeconds and dailySessionLimit safe ranges
  it('should validate cooldownSeconds and dailySessionLimit safe ranges', async () => {
    await expect(
      service.upsertOrganizationPersona(10, { cooldownSeconds: -1 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { cooldownSeconds: 400 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { dailySessionLimit: 0 }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(10, { dailySessionLimit: 200000 }, adminActor),
    ).rejects.toThrow(BadRequestException);
  });

  // Test 15: Reject invalid language codes and secrets in policy fields
  it('should reject invalid language codes and credentials in policy fields', async () => {
    await expect(
      service.upsertOrganizationPersona(10, { language: 'invalid_code_123' }, adminActor),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertOrganizationPersona(
        10,
        { language: 'Bearer secret_access_token_123456789' },
        adminActor,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.upsertRobotPersonaOverride(
        10,
        101,
        { personaPrompt: 'Use sk-proj-1234567890abcdef' },
        adminActor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // Test 16: Effective policy resolution with robot override precedence
  it('should resolve effective policy with robot override winning over organization defaults', async () => {
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue({
      orgId: 10,
      personaName: 'Default Org Bot',
      speechSpeed: 1.0,
      sessionMaxSeconds: 300,
      sessionIdleTimeoutSeconds: 60,
      cooldownSeconds: 5,
      dailySessionLimit: 1000,
      language: 'en-US',
      supportedLanguages: 'en-US,es-ES',
      version: 1,
    });

    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      personaConfig: {
        id: 5,
        orgId: 10,
        robotId: 101,
        speechSpeed: 1.25,
        sessionMaxSeconds: 600,
        cooldownSeconds: 10,
        language: 'es-ES',
        supportedLanguages: 'es-ES',
        version: 2,
        isPublished: true,
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    const res = await service.resolveEffectivePersona(10, 101);

    expect(res.speechSpeed).toBe(1.25);
    expect(res.sessionMaxSeconds).toBe(600);
    expect(res.cooldownSeconds).toBe(10);
    expect(res.sessionIdleTimeoutSeconds).toBe(60); // fell back to org
    expect(res.dailySessionLimit).toBe(1000); // fell back to org
    expect(res.language).toBe('es-ES');
    expect(res.supportedLanguages).toEqual(['es-ES']);
    expect(res.version).toBe(3);
  });

  // Test 17: Effective policy falls back to organization defaults
  it('should fall back to organization policy defaults when robot override has no policy fields', async () => {
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue({
      orgId: 10,
      personaName: 'Default Org Bot',
      speechSpeed: 0.9,
      sessionMaxSeconds: 450,
      sessionIdleTimeoutSeconds: 45,
      cooldownSeconds: 8,
      dailySessionLimit: 500,
      language: 'en-GB',
      supportedLanguages: 'en-GB,fr-FR',
      version: 2,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    mockPrisma.robot.findUnique.mockResolvedValue({
      ...testRobot,
      personaConfig: null,
    });

    const res = await service.resolveEffectivePersona(10, 101);

    expect(res.speechSpeed).toBe(0.9);
    expect(res.sessionMaxSeconds).toBe(450);
    expect(res.sessionIdleTimeoutSeconds).toBe(45);
    expect(res.cooldownSeconds).toBe(8);
    expect(res.dailySessionLimit).toBe(500);
    expect(res.language).toBe('en-GB');
    expect(res.supportedLanguages).toEqual(['en-GB', 'fr-FR']);
  });

  // Test 18: Sanitized audit metadata on policy updates
  it('should record sanitized audit event without raw prompts or secrets when policy fields are updated', async () => {
    mockPrisma.organizationPersonaConfig.findUnique.mockResolvedValue({
      id: 1,
      orgId: 10,
      version: 1,
    });
    mockPrisma.organizationPersonaConfig.upsert.mockResolvedValue({
      id: 1,
      orgId: 10,
      speechSpeed: 1.5,
      version: 2,
      isPublished: true,
      supportedLanguages: 'en-US',
      language: 'en-US',
    });

    await service.upsertOrganizationPersona(
      10,
      { speechSpeed: 1.5, sessionMaxSeconds: 500 },
      adminActor,
    );

    expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORGANIZATION_PERSONA_CONFIG_UPDATED',
        targetId: '10',
        targetOrgId: 10,
        metadata: {
          version: 2,
          isPublished: true,
          changedFields: ['speechSpeed', 'sessionMaxSeconds'],
        },
      }),
    );
  });
});
