import { CapabilityOverrideEffect, SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementsService } from "./entitlements.service";

describe("EntitlementsService effective resolver", () => {
  const audio = {
    id: 1,
    stableKey: "audio.speaker",
    name: "Speaker Output",
    description: null,
    category: "audio",
    version: 1,
    requiredHardware: { capabilities: ["speaker"] },
    isActive: true,
  };
  const camera = {
    id: 2,
    stableKey: "camera.capture",
    name: "Camera Capture",
    description: null,
    category: "vision",
    version: 1,
    requiredHardware: { capabilities: ["camera"] },
    isActive: true,
  };
  const speech = {
    id: 3,
    stableKey: "speech.recognition",
    name: "Speech Recognition",
    description: null,
    category: "speech",
    version: 1,
    requiredHardware: { capabilities: ["microphone"] },
    isActive: true,
  };
  const arm = {
    id: 4,
    stableKey: "motion.arm",
    name: "Arm Motion",
    description: null,
    category: "motion",
    version: 1,
    requiredHardware: { capabilities: ["armMotion"] },
    isActive: true,
  };

  const prisma = {
    organizationSubscription: { findFirst: jest.fn() },
    organizationCapabilityOverride: { findMany: jest.fn() },
    robotCapabilityAssignment: { findMany: jest.fn() },
    userCapabilityAssignment: { findMany: jest.fn() },
  };

  let service: EntitlementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EntitlementsService(prisma as unknown as PrismaService);
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 10,
      orgId: 7,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "pro",
        version: 3,
        isActive: true,
        capabilities: [
          { capability: audio },
          { capability: camera },
          { capability: speech },
        ],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([
      { effect: CapabilityOverrideEffect.DENY, capability: speech },
      { effect: CapabilityOverrideEffect.ALLOW, capability: arm },
    ]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([
      { isEnabled: true, limits: { maxVolume: 80 }, capability: audio },
      { isEnabled: true, limits: { maxPhotos: 5 }, capability: camera },
      { isEnabled: true, limits: null, capability: speech },
      { isEnabled: true, limits: { maxDegrees: 30 }, capability: arm },
    ]);
    prisma.userCapabilityAssignment.findMany.mockResolvedValue([
      { isEnabled: true, limits: { maxVolume: 60 }, capability: audio },
      { isEnabled: true, limits: { maxPhotos: 2 }, capability: camera },
      { isEnabled: true, limits: null, capability: arm },
    ]);
  });

  it("passes the subscription/org/robot/user/hardware intersection matrix", async () => {
    const result = await service.resolve({
      orgId: 7,
      robotId: 11,
      userId: 20,
      hardwareCapabilities: {
        speaker: true,
        camera: true,
        microphone: true,
        armMotion: false,
      },
      enforceHardware: true,
    });

    expect(result.subscription).toEqual({
      status: "ACTIVE",
      planId: 2,
      planStableKey: "pro",
      planVersion: 3,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
    });
    expect(
      result.paidCapabilities.map((capability) => capability.stableKey),
    ).toEqual(["audio.speaker", "camera.capture"]);
    expect(
      result.paidCapabilities.find(
        (capability) => capability.stableKey === "audio.speaker",
      )?.limits,
    ).toEqual({ maxVolume: 60 });
    expect(
      result.paidCapabilities.find(
        (capability) => capability.stableKey === "camera.capture",
      )?.limits,
    ).toEqual({ maxPhotos: 2 });
    expect(
      result.paidCapabilities.map((capability) => capability.stableKey),
    ).not.toContain("speech.recognition");
    expect(
      result.paidCapabilities.map((capability) => capability.stableKey),
    ).not.toContain("motion.arm");
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("removes paid capabilities when subscription is expired", async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 10,
      orgId: 7,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2025-01-01T00:00:00.000Z"),
      validUntil: new Date("2025-02-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "pro",
        version: 3,
        isActive: true,
        capabilities: [{ capability: audio }],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);

    const result = await service.resolve({
      orgId: 7,
      robotId: 11,
      hardwareCapabilities: { speaker: true },
      enforceHardware: true,
    });

    expect(result.subscription).toEqual(
      expect.objectContaining({ status: "EXPIRED" }),
    );
    expect(result.paidCapabilities).toEqual([]);
  });

  it("does not apply hardware filtering when resolving user-only capabilities", async () => {
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([]);
    prisma.userCapabilityAssignment.findMany.mockResolvedValue([
      { isEnabled: true, limits: { maxVolume: 60 }, capability: audio },
      { isEnabled: true, limits: { maxPhotos: 2 }, capability: camera },
    ]);

    const result = await service.resolve({ orgId: 7, userId: 20 });

    expect(
      result.paidCapabilities.map((capability) => capability.stableKey),
    ).toEqual(["audio.speaker", "camera.capture"]);
  });

  it("can resolve organization-only keys for assignment validation", async () => {
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([
      { effect: CapabilityOverrideEffect.DENY, capability: speech },
    ]);

    const result = await service.resolveCapabilityKeys({
      orgId: 7,
      hardwareCapabilities: { speaker: true, camera: false },
      enforceHardware: true,
    });

    expect(Array.from(result)).toEqual(["audio.speaker"]);
  });
});
