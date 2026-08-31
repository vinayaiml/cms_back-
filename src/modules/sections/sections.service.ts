import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { z } from 'zod';

const TemplateTypeSchema = z.enum(['NONE', 'WIDGETS', 'KPI_OVERVIEW', 'MARKDOWN']);

const WidgetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('LINK'),
    label: z.string().min(1),
    description: z.string().optional(),
    path: z.string().min(1),
    requiredPermission: z.string().optional(),
  }),
  z.object({
    type: z.literal('KPI'),
    label: z.string().min(1),
    description: z.string().optional(),
    metric: z.string().min(1),
    format: z.enum(['NUMBER', 'SECONDS', 'MINUTES', 'HOURS']).optional(),
    requiredPermission: z.string().optional(),
  }),
  z.object({
    type: z.literal('TEXT'),
    label: z.string().optional(),
    text: z.string().min(1),
    requiredPermission: z.string().optional(),
  }),
]);

const WidgetsTemplateConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  // If KPI widgets are used, this defines the window used for analytics
  analytics: z
    .object({
      days: z.number().int().min(1).max(365).optional(),
      orgId: z.number().int().optional(),
      orgScope: z.enum(['CURRENT', 'GLOBAL', 'SPECIFIC']).optional(),
    })
    .optional(),
  widgets: z.array(WidgetSchema).default([]),
});

const KpiOverviewTemplateConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  days: z.number().int().min(1).max(365).default(7),
  showTopCourses: z.boolean().optional(),
  showTopLessons: z.boolean().optional(),
  orgId: z.number().int().optional(),
  orgScope: z.enum(['CURRENT', 'GLOBAL', 'SPECIFIC']).optional(),
});

const MarkdownTemplateConfigSchema = z.object({
  title: z.string().optional(),
  markdown: z.string().default(''),
});

@Injectable()
export class SectionsService {
  constructor(private prisma: PrismaService) {}

  private parseTemplate(input: { templateType?: string | null; templateConfig?: any | null }) {
    const templateType = TemplateTypeSchema.parse((input.templateType || 'NONE').toUpperCase());

    if (templateType === 'NONE') {
      return { templateType, templateConfig: null };
    }

    if (templateType === 'WIDGETS') {
      const templateConfig = WidgetsTemplateConfigSchema.parse(input.templateConfig || {});
      return { templateType, templateConfig };
    }

    if (templateType === 'KPI_OVERVIEW') {
      const templateConfig = KpiOverviewTemplateConfigSchema.parse(input.templateConfig || {});
      return { templateType, templateConfig };
    }

    if (templateType === 'MARKDOWN') {
      const templateConfig = MarkdownTemplateConfigSchema.parse(input.templateConfig || {});
      return { templateType, templateConfig };
    }

    // Should never happen because TemplateTypeSchema restricts values
    throw new BadRequestException('Invalid template type');
  }

  async listAll() {
    return this.prisma.dashboardSection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async create(data: {
    key: string;
    label: string;
    path: string;
    icon?: string | null;
    sortOrder?: number | null;
    requiredPermission?: string | null;
    isSuperAdminOnly?: boolean;
    isActive?: boolean;
    templateType?: string | null;
    templateConfig?: any | null;
  }) {
    // Normalize path
    const path = data.path.startsWith('/') ? data.path : `/${data.path}`;

    // Prevent duplicates
    const existingKey = await this.prisma.dashboardSection.findUnique({ where: { key: data.key } });
    if (existingKey) throw new BadRequestException('Section key already exists');

    const existingPath = await this.prisma.dashboardSection.findFirst({ where: { path } });
    if (existingPath) throw new BadRequestException('A section with this path already exists');

    const { templateType, templateConfig } = this.parseTemplate({
      templateType: data.templateType,
      templateConfig: data.templateConfig,
    });

    return this.prisma.dashboardSection.create({
      data: {
        key: data.key,
        label: data.label,
        path,
        icon: data.icon ?? null,
        sortOrder: data.sortOrder ?? 0,
        requiredPermission: data.requiredPermission ?? null,
        isSuperAdminOnly: data.isSuperAdminOnly ?? false,
        isActive: data.isActive ?? true,
        templateType: templateType as any,
        templateConfig: templateConfig as any,
      },
    });
  }

  async update(id: number, data: {
    label?: string;
    path?: string;
    icon?: string | null;
    sortOrder?: number;
    requiredPermission?: string | null;
    isSuperAdminOnly?: boolean;
    isActive?: boolean;
    templateType?: string | null;
    templateConfig?: any | null;
  }) {
    const existing = await this.prisma.dashboardSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Section not found');

    const updateData: any = { ...data };

    // If template fields are present, validate them.
    if (data.templateType !== undefined || data.templateConfig !== undefined) {
      const { templateType, templateConfig } = this.parseTemplate({
        templateType: data.templateType ?? existing.templateType,
        templateConfig: data.templateConfig ?? existing.templateConfig,
      });
      updateData.templateType = templateType;
      updateData.templateConfig = templateConfig;
    }

    if (data.path) {
      const newPath = data.path.startsWith('/') ? data.path : `/${data.path}`;
      const other = await this.prisma.dashboardSection.findFirst({
        where: { path: newPath, id: { not: id } },
      });
      if (other) throw new BadRequestException('A section with this path already exists');
      updateData.path = newPath;
    }

    return this.prisma.dashboardSection.update({
      where: { id },
      data: updateData,
    });
  }

  async deactivate(id: number) {
    const existing = await this.prisma.dashboardSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Section not found');

    return this.prisma.dashboardSection.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
