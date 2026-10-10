import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditActor } from '../audit/audit.types';
import { UpsertConversationContextDto } from './conversation-context.dto';
import { validateNoProhibitedSecretsOrPii } from './context-validation.util';
import { ConversationPublicationService } from '../conversation-publication/conversation-publication.service';

@Injectable()
export class ConversationContextService {
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

  async getConversationContext(orgId: number, actor: AuditActor) {
    this.assertOrgAccess(orgId, actor);

    const context = await this.prisma.organizationConversationContext.findUnique({
      where: { orgId },
    });

    if (!context) {
      return {
        id: null,
        orgId,
        companyOverview: null,
        operatingHours: null,
        locationDetails: null,
        visitorGuidelines: null,
        eventsSummary: null,
        version: 1,
        isPublished: true,
      };
    }

    return context;
  }

  async upsertConversationContext(
    orgId: number,
    dto: UpsertConversationContextDto,
    actor: AuditActor,
  ) {
    this.assertOrgAccess(orgId, actor);

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    // Validate inputs for prohibited secrets, credentials, or PII before persistence
    validateNoProhibitedSecretsOrPii(dto.companyOverview, 'companyOverview');
    validateNoProhibitedSecretsOrPii(dto.operatingHours, 'operatingHours');
    validateNoProhibitedSecretsOrPii(dto.locationDetails, 'locationDetails');
    validateNoProhibitedSecretsOrPii(dto.visitorGuidelines, 'visitorGuidelines');
    validateNoProhibitedSecretsOrPii(dto.eventsSummary, 'eventsSummary');

    const existing = await this.prisma.organizationConversationContext.findUnique({
      where: { orgId },
    });

    const version = existing ? existing.version + 1 : 1;

    const saved = await this.prisma.$transaction(async (tx) => {
      const config = await tx.organizationConversationContext.upsert({
        where: { orgId },
        create: {
          orgId,
          companyOverview: dto.companyOverview ?? null,
          operatingHours: dto.operatingHours ?? null,
          locationDetails: dto.locationDetails ?? null,
          visitorGuidelines: dto.visitorGuidelines ?? null,
          eventsSummary: dto.eventsSummary ?? null,
          isPublished: dto.isPublished ?? true,
          version: 1,
        },
        update: {
          ...(dto.companyOverview !== undefined ? { companyOverview: dto.companyOverview } : {}),
          ...(dto.operatingHours !== undefined ? { operatingHours: dto.operatingHours } : {}),
          ...(dto.locationDetails !== undefined ? { locationDetails: dto.locationDetails } : {}),
          ...(dto.visitorGuidelines !== undefined ? { visitorGuidelines: dto.visitorGuidelines } : {}),
          ...(dto.eventsSummary !== undefined ? { eventsSummary: dto.eventsSummary } : {}),
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
          sourceType: 'conversation_context',
          sourceId: config.id,
          version: config.version,
          previousVersion: existing?.version ?? null,
          snapshot: {
            companyOverview: config.companyOverview,
            operatingHours: config.operatingHours,
            locationDetails: config.locationDetails,
            visitorGuidelines: config.visitorGuidelines,
            eventsSummary: config.eventsSummary,
          },
          actor,
        });
      }

      return config;
    });

    // Record sanitized audit event without raw context body or prohibited secrets
    await this.auditService.recordBestEffort({
      actor,
      action: 'ORGANIZATION_CONVERSATION_CONTEXT_UPDATED',
      targetType: 'ORGANIZATION',
      targetId: String(orgId),
      targetOrgId: orgId,
      metadata: {
        version: saved.version,
        isPublished: saved.isPublished,
        hasCompanyOverview: Boolean(saved.companyOverview),
        hasOperatingHours: Boolean(saved.operatingHours),
        hasLocationDetails: Boolean(saved.locationDetails),
        hasVisitorGuidelines: Boolean(saved.visitorGuidelines),
        hasEventsSummary: Boolean(saved.eventsSummary),
      },
    });

    return saved;
  }

  async getManifestContext(orgId: number) {
    const context = await this.prisma.organizationConversationContext.findUnique({
      where: { orgId },
    });

    if (!context || !context.isPublished) {
      return null;
    }

    return {
      companyOverview: context.companyOverview,
      operatingHours: context.operatingHours,
      locationDetails: context.locationDetails,
      visitorGuidelines: context.visitorGuidelines,
      eventsSummary: context.eventsSummary,
      version: context.version,
    };
  }
}
