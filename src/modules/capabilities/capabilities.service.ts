import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROBOT_HARDWARE_CAPABILITIES, ROBOT_HARDWARE_MODELS } from '../robots/robot-hardware-profile';
import { CapabilityHardwareRequirementsDto } from './capabilities.dto';

const STABLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VALID_ABI = new Set(['arm64-v8a', 'armeabi-v7a']);

type CapabilityInput = {
  stableKey: string;
  name: string;
  description?: string | null;
  category?: string | null;
  version: number;
  requiredHardware?: CapabilityHardwareRequirementsDto | null;
  isActive?: boolean;
};

type CapabilityUpdateInput = Partial<Omit<CapabilityInput, 'stableKey'>>;

@Injectable()
export class CapabilitiesService {
  constructor(private prisma: PrismaService) {}

  private normalizeStableKey(value: string) {
    const stableKey = value.trim();
    if (!STABLE_KEY_PATTERN.test(stableKey)) {
      throw new BadRequestException('Capability stable key must be lowercase letters, numbers, dots, underscores or hyphens');
    }
    return stableKey;
  }

  private cleanString(value: string | null | undefined, field: string, max = 120) {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) throw new BadRequestException(`Capability ${field} is too long`);
    return trimmed;
  }

  private normalizeHardwareRequirements(input?: CapabilityHardwareRequirementsDto | null): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
    if (input === undefined || input === null) return Prisma.JsonNull;
    if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid capability hardware requirements');

    const normalized: Record<string, unknown> = {};

    if (input.models !== undefined) {
      const models = Array.from(new Set(input.models.map((model) => model.trim()).filter(Boolean)));
      for (const model of models) {
        if (!(ROBOT_HARDWARE_MODELS as readonly string[]).includes(model)) {
          throw new BadRequestException('Invalid capability hardware model requirement');
        }
      }
      normalized.models = models;
    }

    if (input.capabilities !== undefined) {
      const capabilities = Array.from(new Set(input.capabilities.map((capability) => capability.trim()).filter(Boolean)));
      for (const capability of capabilities) {
        if (!(ROBOT_HARDWARE_CAPABILITIES as readonly string[]).includes(capability)) {
          throw new BadRequestException('Invalid capability hardware capability requirement');
        }
      }
      normalized.capabilities = capabilities;
    }

    if (input.minAndroidApiLevel !== undefined) normalized.minAndroidApiLevel = input.minAndroidApiLevel;

    if (input.abi !== undefined) {
      const abi = Array.from(new Set(input.abi.map((item) => item.trim()).filter(Boolean)));
      for (const item of abi) {
        if (!VALID_ABI.has(item)) throw new BadRequestException('Invalid capability ABI requirement');
      }
      normalized.abi = abi;
    }

    return Object.keys(normalized).length ? (normalized as Prisma.InputJsonObject) : Prisma.JsonNull;
  }

  async list(options: { includeInactive?: boolean } = {}) {
    return this.prisma.capability.findMany({
      where: options.includeInactive ? undefined : { isActive: true },
      orderBy: [{ category: 'asc' }, { stableKey: 'asc' }],
    });
  }

  async get(id: number, options: { includeInactive?: boolean } = {}) {
    const capability = await this.prisma.capability.findFirst({
      where: { id, ...(options.includeInactive ? {} : { isActive: true }) },
    });
    if (!capability) throw new NotFoundException('Capability not found');
    return capability;
  }

  async create(data: CapabilityInput) {
    const stableKey = this.normalizeStableKey(data.stableKey);
    const version = Number(data.version);
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('Capability version must be a positive integer');

    const existing = await this.prisma.capability.findUnique({ where: { stableKey }, select: { id: true } });
    if (existing) throw new ConflictException('Capability stable key already exists');

    try {
      return await this.prisma.capability.create({
        data: {
          stableKey,
          name: this.cleanString(data.name, 'name') ?? stableKey,
          description: this.cleanString(data.description, 'description', 500),
          category: this.cleanString(data.category, 'category', 80),
          version,
          requiredHardware: this.normalizeHardwareRequirements(data.requiredHardware),
          isActive: data.isActive ?? true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Capability stable key already exists');
      }
      throw error;
    }
  }

  async update(id: number, data: CapabilityUpdateInput) {
    await this.get(id, { includeInactive: true });

    const updateData: Prisma.CapabilityUpdateInput = {};
    if (data.name !== undefined) updateData.name = this.cleanString(data.name, 'name') ?? undefined;
    if (data.description !== undefined) updateData.description = this.cleanString(data.description, 'description', 500);
    if (data.category !== undefined) updateData.category = this.cleanString(data.category, 'category', 80);
    if (data.version !== undefined) {
      if (!Number.isInteger(data.version) || data.version < 1) throw new BadRequestException('Capability version must be a positive integer');
      updateData.version = data.version;
    }
    if (data.requiredHardware !== undefined) updateData.requiredHardware = this.normalizeHardwareRequirements(data.requiredHardware);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.prisma.capability.update({ where: { id }, data: updateData });
  }

  async disable(id: number) {
    await this.get(id, { includeInactive: true });
    return this.prisma.capability.update({ where: { id }, data: { isActive: false } });
  }
}
