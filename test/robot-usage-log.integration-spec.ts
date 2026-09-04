import { LicenseStatus, PrismaClient } from '@prisma/client';

describe('Robot usage log persistence', () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let orgId: number;
  let robotId: number;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: {
        name: `Test Org ${suffix}`,
        state: 'Test State',
        city: 'Test City',
        authorizedPersonName: 'Test Admin',
        contactNo: '0000000000',
      },
    });

    const robot = await prisma.robot.create({
      data: {
        orgId: org.id,
        serialNumber: `TEST-ROBOT-${suffix}`,
        licenseKey: `TEST-LICENSE-${suffix}`,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
        licenseStatus: LicenseStatus.ACTIVE,
      },
    });

    orgId = org.id;
    robotId = robot.id;
  });

  afterAll(async () => {
    if (robotId) {
      await prisma.robot.delete({ where: { id: robotId } });
    }

    if (orgId) {
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  it('persists one usage log and skips duplicate robot event IDs', async () => {
    const eventId = `event-${suffix}`;

    const first = await prisma.robotUsageLog.createMany({
      data: [
        {
          orgId,
          robotId,
          eventId,
          openedAt: new Date('2026-09-01T10:00:00.000Z'),
          durationSec: 45,
        },
      ],
      skipDuplicates: true,
    });

    const duplicate = await prisma.robotUsageLog.createMany({
      data: [
        {
          orgId,
          robotId,
          eventId,
          openedAt: new Date('2026-09-01T10:00:00.000Z'),
          durationSec: 45,
        },
      ],
      skipDuplicates: true,
    });

    const saved = await prisma.robotUsageLog.findMany({
      where: { robotId, eventId },
    });

    expect(first.count).toBe(1);
    expect(duplicate.count).toBe(0);
    expect(saved).toHaveLength(1);
  });
});
