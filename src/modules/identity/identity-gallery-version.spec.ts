import { IdentityService } from "./identity.service";
import {
  encryptProtectedJson,
  protectedJsonFingerprint,
} from "../../common/security/protected-json";

describe("Identity gallery version", () => {
  const originalSecret = process.env.LICENSE_SECRET_KEY;

  beforeAll(() => {
    process.env.LICENSE_SECRET_KEY = "test-license-secret-1234567890123456";
  });

  afterAll(() => {
    process.env.LICENSE_SECRET_KEY = originalSecret;
  });

  function buildService(extraTemplates: Array<Record<string, unknown>> = []) {
    const updatedAt = new Date("2026-10-11T10:00:00.000Z");
    const embeddingMetadata = {
      modelId: "face-std-sface-int8-v1",
      dimension: 128,
      vector: Buffer.alloc(128 * 4).toString("base64"),
      displayName: "Visitor",
    };
    const rows = [
      {
        id: 1,
        orgId: 1,
        subjectRef: "visitor-one",
        consentGranted: true,
        status: "ACTIVE",
        embeddingCiphertext: encryptProtectedJson({ embeddingMetadata }),
        embeddingFingerprint: protectedJsonFingerprint(embeddingMetadata),
        retentionExpiresAt: null,
        deletedAt: null,
        updatedAt,
      },
      {
        id: 2,
        orgId: 1,
        subjectRef: "visitor-two",
        consentGranted: false,
        status: "DELETED",
        embeddingCiphertext: null,
        embeddingFingerprint: null,
        retentionExpiresAt: null,
        deletedAt: updatedAt,
        updatedAt,
      },
    ];
    const templates = [
      {
        identityId: 1,
        modelId: "face-std-sface-int8-v1",
        vectorFingerprint: "fp-1",
        qualityScore: 0.9,
        createdAt: updatedAt,
        vectorCiphertext: encryptProtectedJson({ dimension: 128, vector: "AAAA" }),
      },
      ...extraTemplates,
    ];
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      robot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          orgId: 1,
          revokedAt: null,
          validUntil: new Date(Date.now() + 86_400_000),
          deviceMetadata: null,
        }),
      },
      identityEmbeddingRecord: { findMany: jest.fn().mockResolvedValue(rows) },
      identityTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    };
    return new IdentityService(prisma as any, { recordBestEffort: jest.fn() } as any);
  }

  it("is identical in the robot gallery and the manifest summary", async () => {
    const service = buildService();

    const gallery = await service.getRobotGallery(1, 10);
    const summary = await service.getAuthorizedGallerySummaryForOrg(1);

    expect(gallery.version).toBe(summary.version);
    expect(summary.count).toBe(1);
  });

  it("changes when a template is added", async () => {
    const before = await buildService().getAuthorizedGallerySummaryForOrg(1);
    const after = await buildService([
      {
        identityId: 1,
        modelId: "face-std-sface-int8-v1",
        vectorFingerprint: "fp-2",
        qualityScore: 0.95,
        createdAt: new Date("2026-10-11T11:00:00.000Z"),
        vectorCiphertext: encryptProtectedJson({ dimension: 128, vector: "BBBB" }),
      },
    ]).getAuthorizedGallerySummaryForOrg(1);

    expect(after.version).not.toBe(before.version);
  });
});
