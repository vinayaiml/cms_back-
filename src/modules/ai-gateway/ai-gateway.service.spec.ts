import { ConfigService } from '@nestjs/config';
import { LicenseStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { AiGatewayService } from './ai-gateway.service';
import { AiToolRegistryService } from './tools/ai-tool-registry.service';

describe('AiGatewayService (CMS-69)', () => {
  let service: AiGatewayService;
  let toolRegistry: AiToolRegistryService;

  const mockPrisma = {
    robot: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockAudit = {
    recordBestEffort: jest.fn().mockResolvedValue({ id: 1 }),
  };

  const mockEntitlements = {
    resolve: jest.fn().mockResolvedValue({ capabilities: [] }),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      const configMap: Record<string, string> = {
        AI_GATEWAY_PROVIDER: 'mock',
        AI_GATEWAY_API_KEY: '',
        AI_GATEWAY_BASE_URL: 'https://api.openai.com/v1',
        AI_GATEWAY_MODEL: 'gpt-4o-mini',
        AI_GATEWAY_TIMEOUT_MS: '8000',
        AI_GATEWAY_MAX_TOKENS: '500',
        AI_GATEWAY_MAX_RETRIES: '1',
      };
      return configMap[key] || '';
    }),
  };

  const activeRobot = {
    id: 10,
    orgId: 1,
    name: 'Sanbot Alpha',
    licenseStatus: LicenseStatus.ACTIVE,
    validUntil: new Date('2099-01-01T00:00:00.000Z'),
    revokedAt: null,
    org: {
      id: 1,
      name: 'Whiz Academy',
      isActive: true,
      city: 'Metropolis',
      state: 'CA',
      authorizedPersonName: 'Principal Skinner',
      contactNo: '555-0199',
      primaryColor: '#EC7B21',
      secondaryColor: '#FFFFFF',
      logoUrl: 'https://example.com/logo.png',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    toolRegistry = new AiToolRegistryService(
      mockPrisma as unknown as PrismaService,
      mockEntitlements as unknown as EntitlementsService,
      mockAudit as unknown as AuditService,
    );

    service = new AiGatewayService(
      mockPrisma as unknown as PrismaService,
      mockConfig as unknown as ConfigService,
      toolRegistry,
      mockAudit as unknown as AuditService,
    );

    mockPrisma.robot.findUnique.mockResolvedValue(activeRobot);
    mockPrisma.robot.findFirst.mockResolvedValue(activeRobot);
    mockPrisma.organization.findUnique.mockResolvedValue(activeRobot.org);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 101, fullName: 'Alice Johnson' },
      { id: 102, fullName: 'Bob Williams' },
    ]);
  });

  // Test 1: Direct conversational reply
  it('should successfully process conversation and return direct reply when no tool is needed', async () => {
    const res = await service.converse(10, { message: 'Hello there!' });

    expect(res).toBeDefined();
    expect(res.conversationId).toBeDefined();
    expect(res.reply).toContain('Hello');
    expect(res.speechText).toBeDefined();
    expect(res.fallbackUsed).toBe(false);
    expect(res.toolExecutions).toHaveLength(0);
    expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_CONVERSATION',
        targetId: '10',
        targetOrgId: 1,
      }),
    );
  });

  // Test 2: Inactive organization rejection
  it('should reject conversation when robot organization is inactive (DomainLockedException)', async () => {
    mockPrisma.robot.findUnique.mockResolvedValue({
      ...activeRobot,
      org: { ...activeRobot.org, isActive: false },
    });

    await expect(service.converse(10, { message: 'Hello' })).rejects.toThrow(
      DomainLockedException,
    );
  });

  // Test 3: Inactive / expired license rejection
  it('should reject conversation when robot license is not active or expired (DomainLockedException)', async () => {
    mockPrisma.robot.findUnique.mockResolvedValue({
      ...activeRobot,
      licenseStatus: LicenseStatus.EXPIRED,
    });

    await expect(service.converse(10, { message: 'Hello' })).rejects.toThrow(
      DomainLockedException,
    );
  });

  // Test 4: Unregistered tool rejection and audit
  it('should reject unregistered tool call safely and record audit event', async () => {
    const res = await service.converse(10, {
      message: 'Please run unregistered_tool now',
    });

    expect(res.toolExecutions).toHaveLength(1);
    expect(res.toolExecutions[0].status).toBe('REJECTED');
    expect(res.toolExecutions[0].toolName).toBe('unregistered_tool');
    expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_UNREGISTERED_TOOL_REJECTED',
        targetType: 'AI_TOOL',
        targetOrgId: 1,
      }),
    );
  });

  // Test 5: getApprovedOrganisationInformation tool execution
  it('should execute getApprovedOrganisationInformation within organization scope', async () => {
    const res = await service.converse(10, {
      message: 'Tell me about this school and organization',
    });

    expect(res.toolExecutions).toHaveLength(1);
    expect(res.toolExecutions[0].toolName).toBe('getApprovedOrganisationInformation');
    expect(res.toolExecutions[0].status).toBe('EXECUTED');
    expect(res.toolExecutions[0].output?.organizationName).toBe('Whiz Academy');
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: expect.any(Object),
    });
  });

  // Test 6: searchStaff tool execution
  it('should execute searchStaff returning scoped staff members', async () => {
    const res = await service.converse(10, {
      message: 'Who are the teachers and staff members here?',
    });

    expect(res.toolExecutions).toHaveLength(1);
    expect(res.toolExecutions[0].toolName).toBe('searchStaff');
    expect(res.toolExecutions[0].status).toBe('EXECUTED');
    expect(res.toolExecutions[0].output?.count).toBe(2);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 1, isLocked: false }),
      }),
    );
  });

  // Test 7: requestMovement tool execution with valid parameters
  it('should execute requestMovement with valid parameters and return approved action', async () => {
    const res = await service.converse(10, {
      message: 'Please move forward 2 meters',
    });

    expect(res.toolExecutions).toHaveLength(1);
    expect(res.toolExecutions[0].toolName).toBe('requestMovement');
    expect(res.toolExecutions[0].status).toBe('EXECUTED');
    expect(res.action).toEqual({
      type: 'ROBOT_MOVEMENT',
      payload: expect.objectContaining({
        movementType: 'NAVIGATE_FORWARD',
        distanceMeters: 2,
      }),
    });
  });

  // Test 8: requestMovement rejected by safety policy when distance exceeds 5.0m
  it('should reject requestMovement when distance exceeds safety limit (5.0m)', async () => {
    const res = await service.converse(10, {
      message: 'Please move forward 10 meters immediately',
    });

    expect(res.toolExecutions).toHaveLength(1);
    expect(res.toolExecutions[0].toolName).toBe('requestMovement');
    expect(res.toolExecutions[0].status).toBe('REJECTED');
    expect(res.toolExecutions[0].reason).toContain('safety policy');
    expect(res.action).toBeNull();
  });

  // Test 9: Safe fallback when provider fails or times out without leaking secrets
  it('should use safe fallback when provider fails or times out without leaking secrets', async () => {
    // Configure live provider with API key
    mockConfig.get.mockImplementation((key: string) => {
      const liveConfig: Record<string, string> = {
        AI_GATEWAY_PROVIDER: 'openai',
        AI_GATEWAY_API_KEY: 'sk-secret-test-key-do-not-leak',
        AI_GATEWAY_BASE_URL: 'https://api.openai.com/v1',
        AI_GATEWAY_MODEL: 'gpt-4o-mini',
        AI_GATEWAY_TIMEOUT_MS: '1000',
        AI_GATEWAY_MAX_RETRIES: '0',
      };
      return liveConfig[key] || '';
    });

    // Mock global fetch to simulate failure
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection timeout to model host'));

    try {
      const res = await service.converse(10, { message: 'Can you hear me?' });

      expect(res.fallbackUsed).toBe(true);
      expect(res.reply).toContain('trouble connecting to my central conversation service');
      expect(res.reply).not.toContain('sk-secret-test-key');
      expect(res.reply).not.toContain('Connection timeout');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
