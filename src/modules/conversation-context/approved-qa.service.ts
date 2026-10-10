import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActor } from '../audit/audit.types';
import {
  ApprovedQaItemDto,
  QueryApprovedQaDto,
  UpsertApprovedQaDto,
} from './conversation-context.dto';
import { validateNoProhibitedSecretsOrPii } from './context-validation.util';

@Injectable()
export class ApprovedQaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private assertOrgAccess(orgId: number, actor: AuditActor) {
    if (!actor.isSuperAdmin && actor.orgId !== orgId) {
      throw new ForbiddenException('Tenant access forbidden');
    }
  }

  async listApprovedQa(orgId: number, actor: AuditActor, query?: QueryApprovedQaDto) {
    this.assertOrgAccess(orgId, actor);

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const where: any = { orgId };
    if (query?.category) {
      where.category = query.category;
    }
    if (query?.includeUnpublished !== true) {
      where.isPublished = true;
    }

    const items = await this.prisma.organizationApprovedQa.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return {
      items,
      total: items.length,
    };
  }

  async getApprovedQaById(orgId: number, id: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const item = await this.prisma.organizationApprovedQa.findUnique({
      where: { id },
    });

    if (!item || item.orgId !== orgId) {
      throw new NotFoundException('Approved Q&A item not found');
    }

    return item;
  }

  async upsertApprovedQa(
    orgId: number,
    dto: UpsertApprovedQaDto,
    actor: AuditActor,
  ) {
    this.assertOrgAccess(orgId, actor);

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    // Determine items to process
    let itemsToProcess: ApprovedQaItemDto[] = [];
    if (dto.items && Array.isArray(dto.items) && dto.items.length > 0) {
      itemsToProcess = dto.items;
    } else if (dto.question && dto.answer) {
      itemsToProcess = [
        {
          id: dto.id,
          question: dto.question,
          answer: dto.answer,
          category: dto.category,
          isPublished: dto.isPublished,
          sortOrder: dto.sortOrder,
        },
      ];
    } else {
      throw new BadRequestException(
        'At least one approved Q&A item must be provided',
      );
    }

    // Validate all items before persistence
    for (const item of itemsToProcess) {
      if (!item.question || !item.answer) {
        throw new BadRequestException('Question and answer are required');
      }
      validateNoProhibitedSecretsOrPii(item.question, 'question');
      validateNoProhibitedSecretsOrPii(item.answer, 'answer');
      validateNoProhibitedSecretsOrPii(item.category, 'category');
    }

    const savedItems = await this.prisma.$transaction(async (tx) => {
      const results = [];

      for (const item of itemsToProcess) {
        if (item.id) {
          const existing = await tx.organizationApprovedQa.findUnique({
            where: { id: item.id },
          });

          if (!existing || existing.orgId !== orgId) {
            throw new NotFoundException(
              `Approved Q&A item with id ${item.id} not found in organization`,
            );
          }

          const updated = await tx.organizationApprovedQa.update({
            where: { id: item.id },
            data: {
              question: item.question,
              answer: item.answer,
              category: item.category ?? existing.category,
              isPublished: item.isPublished ?? existing.isPublished,
              sortOrder: item.sortOrder ?? existing.sortOrder,
              version: existing.version + 1,
            },
          });
          results.push(updated);
        } else {
          const created = await tx.organizationApprovedQa.create({
            data: {
              orgId,
              question: item.question,
              answer: item.answer,
              category: item.category ?? null,
              isPublished: item.isPublished ?? true,
              sortOrder: item.sortOrder ?? 0,
              version: 1,
            },
          });
          results.push(created);
        }
      }

      // Increment tenantVersion to invalidate robot sync/manifest cache
      await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
      });

      return results;
    });

    // Record sanitized audit event without raw questions or answers
    await this.auditService.recordBestEffort({
      actor,
      action: 'ORGANIZATION_APPROVED_QA_UPDATED',
      targetType: 'ORGANIZATION',
      targetId: String(orgId),
      targetOrgId: orgId,
      metadata: {
        itemCount: savedItems.length,
        itemIds: savedItems.map((i) => i.id),
      },
    });

    return {
      items: savedItems,
      total: savedItems.length,
    };
  }

  async createApprovedQa(
    orgId: number,
    dto: ApprovedQaItemDto,
    actor: AuditActor,
  ) {
    return this.upsertApprovedQa(orgId, { items: [dto] }, actor).then(
      (res) => res.items[0],
    );
  }

  async deleteApprovedQa(orgId: number, id: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const existing = await this.prisma.organizationApprovedQa.findUnique({
      where: { id },
    });

    if (!existing || existing.orgId !== orgId) {
      throw new NotFoundException('Approved Q&A item not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationApprovedQa.delete({
        where: { id },
      });

      // Increment tenantVersion to invalidate robot sync/manifest cache
      await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
      });
    });

    // Record sanitized audit event
    await this.auditService.recordBestEffort({
      actor,
      action: 'ORGANIZATION_APPROVED_QA_DELETED',
      targetType: 'ORGANIZATION',
      targetId: String(orgId),
      targetOrgId: orgId,
      metadata: {
        deletedQaId: id,
        category: existing.category,
      },
    });

    return {
      success: true,
      id,
    };
  }

  async getManifestApprovedQa(orgId: number) {
    const items = await this.prisma.organizationApprovedQa.findMany({
      where: {
        orgId,
        isPublished: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => ({
      id: item.id,
      question: item.question,
      answer: item.answer,
      category: item.category,
      version: item.version,
      sortOrder: item.sortOrder,
    }));
  }
}
