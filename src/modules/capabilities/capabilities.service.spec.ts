import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CapabilitiesService } from './capabilities.service';

describe('CapabilitiesService', () => {
  const prisma = {
    capability: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: CapabilitiesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CapabilitiesService(prisma as any);
  });

  it('creates a capability with a unique stable key and validated hardware requirements', async () => {
    const created = {
      id: 1,
      stableKey: 'speech.recognition',
      name: 'Speech Recognition',
      version: 1,
      requiredHardware: { models: ['MINI_ELF'], capabilities: ['speechRecognition'], minAndroidApiLevel: 23 },
      isActive: true,
    };

    prisma.capability.findUnique.mockResolvedValue(null);
    prisma.capability.create.mockResolvedValue(created);

    const result = await service.create({
      stableKey: 'speech.recognition',
      name: 'Speech Recognition',
      category: 'speech',
      version: 1,
      requiredHardware: {
        models: ['MINI_ELF', 'MINI_ELF'],
        capabilities: ['speechRecognition'],
        minAndroidApiLevel: 23,
      },
    });

    expect(prisma.capability.create).toHaveBeenCalledWith({
      data: {
        stableKey: 'speech.recognition',
        name: 'Speech Recognition',
        description: null,
        category: 'speech',
        version: 1,
        requiredHardware: { models: ['MINI_ELF'], capabilities: ['speechRecognition'], minAndroidApiLevel: 23 },
        isActive: true,
      },
    });
    expect(result).toBe(created);
  });

  it('rejects duplicate stable keys before creating a capability', async () => {
    prisma.capability.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.create({ stableKey: 'camera.capture', name: 'Camera Capture', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.capability.create).not.toHaveBeenCalled();
  });

  it('maps database unique conflicts to the shared safe duplicate error', async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'unit-test',
    });

    prisma.capability.findUnique.mockResolvedValue(null);
    prisma.capability.create.mockRejectedValue(duplicateError);

    await expect(
      service.create({ stableKey: 'camera.capture', name: 'Camera Capture', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid stable keys and invalid hardware requirement values', async () => {
    await expect(
      service.create({ stableKey: 'Camera Capture', name: 'Camera Capture', version: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create({
        stableKey: 'camera.capture',
        name: 'Camera Capture',
        version: 1,
        requiredHardware: { capabilities: ['unknownCapability'] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.capability.create).not.toHaveBeenCalled();
  });

  it('updates version and can soft-disable a capability without deleting the row', async () => {
    prisma.capability.findFirst.mockResolvedValue({ id: 1, stableKey: 'camera.capture', version: 1, isActive: true });
    prisma.capability.update.mockResolvedValue({ id: 1, stableKey: 'camera.capture', version: 2, isActive: false });

    const updated = await service.update(1, { version: 2, isActive: false });

    expect(prisma.capability.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { version: 2, isActive: false } });
    expect(updated.version).toBe(2);
  });

  it('returns active capabilities by default and hides inactive rows from normal reads', async () => {
    prisma.capability.findMany.mockResolvedValue([]);
    prisma.capability.findFirst.mockResolvedValue(null);

    await service.list();
    await expect(service.get(99)).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.capability.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { stableKey: 'asc' }],
    });
    expect(prisma.capability.findFirst).toHaveBeenCalledWith({ where: { id: 99, isActive: true } });
  });
});
