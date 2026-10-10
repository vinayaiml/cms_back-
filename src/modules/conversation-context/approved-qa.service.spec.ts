import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApprovedQaService } from './approved-qa.service';
import { AuditActor } from '../audit/audit.types';

describe('ApprovedQaService (CMS-71)', () => {
  let service: ApprovedQaService;

  const mockPrisma: any = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    organizationApprovedQa: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApprovedQaService(mockPrisma, mockAudit as any);
  });

  describe('listApprovedQa', () => {
    it('lists published approved Q&A items ordered by sortOrder', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      const items = [
        { id: 1, orgId: 10, question: 'Q1', answer: 'A1', sortOrder: 0, isPublished: true },
        { id: 2, orgId: 10, question: 'Q2', answer: 'A2', sortOrder: 1, isPublished: true },
      ];
      mockPrisma.organizationApprovedQa.findMany.mockResolvedValue(items);

      const result = await service.listApprovedQa(10, adminActor);
      expect(result).toEqual({ items, total: 2 });
      expect(mockPrisma.organizationApprovedQa.findMany).toHaveBeenCalledWith({
        where: { orgId: 10, isPublished: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
    });

    it('filters by category when specified', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.findMany.mockResolvedValue([]);

      await service.listApprovedQa(10, adminActor, { category: 'admissions' });
      expect(mockPrisma.organizationApprovedQa.findMany).toHaveBeenCalledWith({
        where: { orgId: 10, category: 'admissions', isPublished: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
    });

    it('includes unpublished items when requested', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.findMany.mockResolvedValue([]);

      await service.listApprovedQa(10, adminActor, { includeUnpublished: true });
      expect(mockPrisma.organizationApprovedQa.findMany).toHaveBeenCalledWith({
        where: { orgId: 10 },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
    });

    it('throws NotFoundException if organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.listApprovedQa(10, adminActor)).rejects.toThrow(NotFoundException);
    });

    it('enforces tenant isolation and throws ForbiddenException for cross-tenant access', async () => {
      await expect(service.listApprovedQa(10, otherTenantActor)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows super admin to list Q&As for any organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.findMany.mockResolvedValue([]);

      const result = await service.listApprovedQa(10, superAdminActor);
      expect(result.total).toBe(0);
    });
  });

  describe('getApprovedQaById', () => {
    it('returns item by id when found in organization', async () => {
      const item = { id: 5, orgId: 10, question: 'Q', answer: 'A' };
      mockPrisma.organizationApprovedQa.findUnique.mockResolvedValue(item);

      const result = await service.getApprovedQaById(10, 5, adminActor);
      expect(result).toEqual(item);
    });

    it('throws NotFoundException if item belongs to different organization', async () => {
      mockPrisma.organizationApprovedQa.findUnique.mockResolvedValue({
        id: 5,
        orgId: 99,
      });

      await expect(service.getApprovedQaById(10, 5, adminActor)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('upsertApprovedQa', () => {
    it('creates new Q&A item with version 1', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      const createdItem = {
        id: 1,
        orgId: 10,
        question: 'Where is library?',
        answer: 'Building C',
        category: 'facilities',
        isPublished: true,
        sortOrder: 0,
        version: 1,
      };
      mockPrisma.organizationApprovedQa.create.mockResolvedValue(createdItem);

      const result = await service.upsertApprovedQa(
        10,
        {
          question: 'Where is library?',
          answer: 'Building C',
          category: 'facilities',
        },
        adminActor,
      );

      expect(result.items).toEqual([createdItem]);
      expect(mockPrisma.organizationApprovedQa.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: 10,
          question: 'Where is library?',
          answer: 'Building C',
          version: 1,
        }),
      });
    });

    it('updates existing item and increments version', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.findUnique.mockResolvedValue({
        id: 1,
        orgId: 10,
        version: 2,
        category: 'general',
        isPublished: true,
        sortOrder: 0,
      });

      const updatedItem = {
        id: 1,
        orgId: 10,
        question: 'Updated question',
        answer: 'Updated answer',
        version: 3,
      };
      mockPrisma.organizationApprovedQa.update.mockResolvedValue(updatedItem);

      const result = await service.upsertApprovedQa(
        10,
        {
          items: [{ id: 1, question: 'Updated question', answer: 'Updated answer' }],
        },
        adminActor,
      );

      expect(result.items).toEqual([updatedItem]);
      expect(mockPrisma.organizationApprovedQa.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          version: 3,
          question: 'Updated question',
          answer: 'Updated answer',
        }),
      });
    });

    it('handles batch items upsert', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.create
        .mockResolvedValueOnce({ id: 1, question: 'Q1', answer: 'A1' })
        .mockResolvedValueOnce({ id: 2, question: 'Q2', answer: 'A2' });

      const result = await service.upsertApprovedQa(
        10,
        {
          items: [
            { question: 'Q1', answer: 'A1' },
            { question: 'Q2', answer: 'A2' },
          ],
        },
        adminActor,
      );

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('bumps organization tenantVersion to invalidate robot manifest', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.create.mockResolvedValue({ id: 1 });

      await service.upsertApprovedQa(
        10,
        { question: 'Q', answer: 'A' },
        adminActor,
      );

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { tenantVersion: { increment: 1 } },
      });
    });

    it('throws BadRequestException if no items provided', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertApprovedQa(10, {}, adminActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects secret or API key in question or answer with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertApprovedQa(
          10,
          { question: 'Where is key?', answer: 'Bearer secret_access_token_123456789' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.upsertApprovedQa(
          10,
          { question: 'Use sk-abcdef1234567890abcdef', answer: 'Valid answer' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects credit card or SSN in question or answer with BadRequestException', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);

      await expect(
        service.upsertApprovedQa(
          10,
          { question: 'Q', answer: 'Card is 4111-2222-3333-4444' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.upsertApprovedQa(
          10,
          { question: 'My SSN is 000-12-3456', answer: 'Noted' },
          adminActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('records sanitized audit event without raw question or answer text', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(testOrg);
      mockPrisma.organizationApprovedQa.create.mockResolvedValue({ id: 101 });

      await service.upsertApprovedQa(
        10,
        { question: 'Confidential topic?', answer: 'Confidential reply.' },
        adminActor,
      );

      expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORGANIZATION_APPROVED_QA_UPDATED',
          targetId: '10',
          targetOrgId: 10,
          metadata: {
            itemCount: 1,
            itemIds: [101],
          },
        }),
      );

      const callArgs = mockAudit.recordBestEffort.mock.calls[0][0];
      expect(JSON.stringify(callArgs.metadata)).not.toContain('Confidential');
    });
  });

  describe('deleteApprovedQa', () => {
    it('deletes item, bumps org tenantVersion, and records sanitized audit event', async () => {
      mockPrisma.organizationApprovedQa.findUnique.mockResolvedValue({
        id: 7,
        orgId: 10,
        category: 'admissions',
      });
      mockPrisma.organizationApprovedQa.delete.mockResolvedValue({ id: 7 });

      const result = await service.deleteApprovedQa(10, 7, adminActor);
      expect(result).toEqual({ success: true, id: 7 });

      expect(mockPrisma.organizationApprovedQa.delete).toHaveBeenCalledWith({
        where: { id: 7 },
      });
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { tenantVersion: { increment: 1 } },
      });
      expect(mockAudit.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORGANIZATION_APPROVED_QA_DELETED',
          metadata: { deletedQaId: 7, category: 'admissions' },
        }),
      );
    });
  });

  describe('getManifestApprovedQa', () => {
    it('returns published Q&As in proper format and sort order for robot manifest', async () => {
      mockPrisma.organizationApprovedQa.findMany.mockResolvedValue([
        {
          id: 1,
          question: 'Where is room 101?',
          answer: 'First floor right.',
          category: 'navigation',
          version: 2,
          sortOrder: 1,
          isPublished: true,
        },
      ]);

      const result = await service.getManifestApprovedQa(10);
      expect(result).toEqual([
        {
          id: 1,
          question: 'Where is room 101?',
          answer: 'First floor right.',
          category: 'navigation',
          version: 2,
          sortOrder: 1,
        },
      ]);
      expect(mockPrisma.organizationApprovedQa.findMany).toHaveBeenCalledWith({
        where: { orgId: 10, isPublished: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
    });
  });
});
