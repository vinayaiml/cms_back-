import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Capability, Prisma, SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const STABLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

type PlanWithCapabilities = SubscriptionPlan & {
  capabilities: Array<{ capability: Capability }>;
};

type CreatePlanInput = {
  stableKey: string;
  name: string;
  description?: string | null;
  version: number;
  isActive?: boolean;
  capabilityStableKeys?: string[];
};

type UpdatePlanInput = {
  name?: string;
  description?: string | null;
  version?: number;
  isActive?: boolean;
};

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  private normalizeStableKey(value: string) {
    const stableKey = value.trim();
    if (!STABLE_KEY_PATTERN.test(stableKey)) {
      throw new BadRequestException('Subscription plan stable key must be lowercase letters, numbers, dots, underscores or hyphens');
    }
    return stableKey;
  }

  private cleanString(value: string | null | undefined, field: string, max = 120) {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) throw new BadRequestException(`Subscription plan ${field} is too long`);
    return trimmed;
  }

  private normalizeVersion(version: number | undefined) {
    if (version === undefined) return undefined;
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('Subscription plan version must be a positive integer');
    return version;
  }

  private normalizeCapabilityKeys(keys: string[] | undefined) {
    return Array.from(new Set((keys ?? []).map((key) => key.trim()).filter(Boolean))).sort();
  }

  private async resolveActiveCapabilities(stableKeys: string[], tx: Pick<PrismaService, 'capability'> = this.prisma) {
    if (!stableKeys.length) return [];
    const capabilities = await tx.capability.findMany({
      where: { stableKey: { in: stableKeys }, isActive: true },
      orderBy: { stableKey: 'asc' },
    });
    const found = new Set(capabilities.map((capability) => capability.stableKey));
    const missing = stableKeys.filter((key) => !found.has(key));
    if (missing.length) throw new NotFoundException('One or more capabilities not found');
    return capabilities;
  }

  private toResponse(plan: PlanWithCapabilities) {
    const { capabilities, ...rest } = plan;
    return {
      ...rest,
      capabilities: capabilities.map((row) => row.capability).sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
    };
  }

  private includeCapabilities() {
    return {
      capabilities: {
        include: { capability: true },
        orderBy: { capability: { stableKey: 'asc' as const } },
      },
    };
  }

  async list(options: { includeInactive?: boolean } = {}) {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: options.includeInactive ? undefined : { isActive: true },
      include: this.includeCapabilities(),
      orderBy: [{ stableKey: 'asc' }],
    });
    return plans.map((plan) => this.toResponse(plan));
  }

  async get(id: number, options: { includeInactive?: boolean } = {}) {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id, ...(options.includeInactive ? {} : { isActive: true }) },
      include: this.includeCapabilities(),
    });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    return this.toResponse(plan);
  }

  async create(data: CreatePlanInput) {
    const stableKey = this.normalizeStableKey(data.stableKey);
    const version = this.normalizeVersion(data.version);
    if (!version) throw new BadRequestException('Subscription plan version must be a positive integer');
    const capabilityKeys = this.normalizeCapabilityKeys(data.capabilityStableKeys);

    const existing = await this.prisma.subscriptionPlan.findUnique({ where: { stableKey }, select: { id: true } });
    if (existing) throw new ConflictException('Subscription plan stable key already exists');

    const plan = await this.prisma.$transaction(async (tx) => {
      const capabilities = await this.resolveActiveCapabilities(capabilityKeys, tx as any);
      const created = await tx.subscriptionPlan.create({
        data: {
          stableKey,
          name: this.cleanString(data.name, 'name') ?? stableKey,
          description: this.cleanString(data.description, 'description', 500),
          version,
          isActive: data.isActive ?? true,
        },
      });
      if (capabilities.length) {
        await tx.planCapability.createMany({
          data: capabilities.map((capability) => ({ planId: created.id, capabilityId: capability.id })),
          skipDuplicates: true,
        });
      }
      return created;
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Subscription plan stable key already exists');
      }
      throw error;
    });

    return this.get(plan.id, { includeInactive: true });
  }

  async update(id: number, data: UpdatePlanInput) {
    await this.get(id, { includeInactive: true });
    const updateData: Prisma.SubscriptionPlanUpdateInput = {};
    if (data.name !== undefined) updateData.name = this.cleanString(data.name, 'name') ?? undefined;
    if (data.description !== undefined) updateData.description = this.cleanString(data.description, 'description', 500);
    if (data.version !== undefined) updateData.version = this.normalizeVersion(data.version);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    await this.prisma.subscriptionPlan.update({ where: { id }, data: updateData });
    return this.get(id, { includeInactive: true });
  }

  async setCapabilities(id: number, capabilityStableKeys: string[]) {
    await this.get(id, { includeInactive: true });
    const capabilityKeys = this.normalizeCapabilityKeys(capabilityStableKeys);

    await this.prisma.$transaction(async (tx) => {
      const capabilities = await this.resolveActiveCapabilities(capabilityKeys, tx as any);
      await tx.planCapability.deleteMany({ where: { planId: id } });
      if (capabilities.length) {
        await tx.planCapability.createMany({
          data: capabilities.map((capability) => ({ planId: id, capabilityId: capability.id })),
          skipDuplicates: true,
        });
      }
    });

    return this.get(id, { includeInactive: true });
  }

  async disable(id: number) {
    await this.get(id, { includeInactive: true });
    await this.prisma.subscriptionPlan.update({ where: { id }, data: { isActive: false } });
    return this.get(id, { includeInactive: true });
  }
}
