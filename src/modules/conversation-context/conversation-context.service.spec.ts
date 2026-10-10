import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConversationContextService } from './conversation-context.service';
import { AuditActor } from '../audit/audit.types';

describe('ConversationContextService (CMS-71)', () => {
  let service: ConversationContextService;

  const mockPrisma: any = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    organizationConversationContext: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationContextService(mockPrisma, mockAudit as any);
  });

  describe('getConversationContext', () => {
    it('returns safe default when context does not exist for organization', async () => {
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue(null);

      const result = await service.getConversationContext(10, adminActor);

      expect(result).toEqual({
        id: null,
        orgId: 10,
        companyOverview: null,
        operatingHours: null,
        locationDetails: null,
        visitorGuidelines: null,
        eventsSummary: null,
        version: 1,
        isPublished: true,
      });
      expect(mockPrisma.organizationConversationContext.findUnique).toHaveBeenCalledWith({
        where: { orgId: 10 },
      });
    });

    it('returns persisted context when found', async () => {
      const persisted = {
        id: 1,
        orgId: 10,
        companyOverview: 'Whiz High School is a leading STEM academy.',
        operatingHours: 'Mon-Fri 8am-4pm',
        locationDetails: 'Main Campus, Building A',
        visitorGuidelines: 'Check in at security desk.',
        eventsSummary: 'Open House on Friday.',
        version: 2,
        isPublished: true,
      };
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue(persisted);

      const result = await service.getConversationContext(10, adminActor);
      expect(result).toEqual(persisted);
    });

    it('enforces tenant isolation and throws ForbiddenException for mismatched org', async () => {
      await expect(
        service.getConversationContext(10, otherTenantActor),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.organizationConversationContext.findUnique).not.toHaveBeenCalled();
    });

    it('allows super admin to access any organization context', async () => {
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue(null);

      const result = await service.getConversationContext(10, superAdminActor);
      expect(result.orgId).toBe(10);
    });
  });

  describe('upsertConversationContext', () => {
    it('creates new conversation context and sets version to 1', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue(null);

      const savedContext = {
        id: 1,
        orgId: 10,
        companyOverview: 'Overview',
        operatingHours: '9-5',
        locationDetails: 'Floor 1',
        visitorGuidelines: 'Wear badge',
        eventsSummary: 'Tech Fair',
        isPublished: true,
        version: 1,
      };
      mockPrisma.organizationConversationContext.upsert.mockResolvedValue(savedContext);

      const result = await service.upsertConversationContext(
        10,
        {
          companyOverview: 'Overview',
          operatingHours: '9-5',
          locationDetails: 'Floor 1',
          visitorGuidelines: 'Wear badge',
          eventsSummary: 'Tech Fair',
          isPublished: true,
        },
        adminActor,
      );

      expect(result).toEqual(savedContext);
      expect(mockPrisma.organizationConversationContext.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: 10 },
          create: expect.objectContaining({ orgId: 10, version: 1 }),
        }),
      );
    });

    it('updates existing context and increments version', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue({
        id: 1,
        orgId: 10,
        version: 3,
      });

      const updatedContext = {
        id: 1,
        orgId: 10,
        companyOverview: 'Updated overview',
        version: 4,
        isPublished: true,
      };
      mockPrisma.organizationConversationContext.upsert.mockResolvedValue(updatedContext);

      const result = await service.upsertConversationContext(
        10,
        { companyOverview: 'Updated overview' },
        adminActor,
      );

      expect(result.version).toBe(4);
      expect(mockPrisma.organizationConversationContext.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ version: 4, companyOverview: 'Updated overview' }),
        }),
      );
    });

    it('bumps organization tenantVersion to invalidate cache and manifest', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue(null);
      mockPrisma.organizationConversationContext.upsert.mockResolvedValue({
        id: 1,
        orgId: 10,
        version: 1,
        isPublished: true,
      });

      await service.upsertConversationContext(10, { companyOverview: 'Overview' }, adminActor);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { tenantVersion: { increment: 1 } },
      });
    });

    it('throws NotFoundException if organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertConversationContext(10, { companyOverview: 'Overview' }, adminActor),
      ).rejects.toThrow(NotFoundException);
    });

    it('enforces tenant isolation and throws ForbiddenException on direct-ID attempt', async () => {
      await expect(
        service.upsertConversationContext(10, { companyOverview: 'Overview' }, otherTenantActor),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.organizationConversationContext.upsert).not.toHaveBeenCalled();
    });

    it('rejects bearer token credential with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertConversationContext(
          10,
          { companyOverview: 'Bearer secret_token_1234567890abcdef' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects API key credential with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertConversationContext(
          10,
          { companyOverview: 'Please use sk-abcdef1234567890abcdef for access' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects private key credential with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertConversationContext(
          10,
          { companyOverview: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects SSN personal data with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertConversationContext(
          10,
          { visitorGuidelines: 'Provide SSN 123-45-6789 at reception' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects credit card personal data with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertConversationContext(
          10,
          { companyOverview: 'Payment card 4111-2222-3333-4444' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('records sanitized audit event without raw context body or secrets', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue(null);
      mockPrisma.organizationConversationContext.upsert.mockResolvedValue({
        id: 1,
        orgId: 10,
        companyOverview: 'Sensitive details here',
        version: 1,
        isPublished: true,
      });

      await service.upsertConversationContext(
        10,
        { companyOverview: 'Sensitive details here' },
        adminActor,
      );

      expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORGANIZATION_CONVERSATION_CONTEXT_UPDATED',
          targetId: '10',
          targetOrgId: 10,
          metadata: {
            version: 1,
            isPublished: true,
            hasCompanyOverview: true,
            hasOperatingHours: false,
            hasLocationDetails: false,
            hasVisitorGuidelines: false,
            hasEventsSummary: false,
          },
        }),
      );

      // Verify no raw string is passed in audit metadata
      const callArgs = mockAudit.recordBestEffort.mock.calls[0][0];
      expect(JSON.stringify(callArgs.metadata)).not.toContain('Sensitive details');
    });
  });

  describe('getManifestContext', () => {
    it('returns published context for robot manifest', async () => {
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValue({
        id: 1,
        orgId: 10,
        companyOverview: 'Overview',
        operatingHours: '9-5',
        locationDetails: 'Lobby',
        visitorGuidelines: 'Sign in',
        eventsSummary: 'None',
        version: 2,
        isPublished: true,
      });

      const result = await service.getManifestContext(10);
      expect(result).toEqual({
        companyOverview: 'Overview',
        operatingHours: '9-5',
        locationDetails: 'Lobby',
        visitorGuidelines: 'Sign in',
        eventsSummary: 'None',
        version: 2,
      });
    });

    it('returns null if context is unpublished or missing', async () => {
      mockPrisma.organizationConversationContext.findUnique.mockResolvedValueOnce({
        id: 1,
        orgId: 10,
        isPublished: false,
      });

      const unpublished = await service.getManifestContext(10);
      expect(unpublished).toBeNull();

      mockPrisma.organizationConversationContext.findUnique.mockResolvedValueOnce(null);
      const missing = await service.getManifestContext(10);
      expect(missing).toBeNull();
    });
  });
});
