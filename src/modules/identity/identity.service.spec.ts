import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { IdentityService } from "./identity.service";

describe("IdentityService", () => {
  const prisma = {
    identityEmbeddingRecord: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };
  const actor = { userId: 7, orgId: 1, isSuperAdmin: false };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LICENSE_SECRET_KEY =
      "cms-76-test-secret-key-that-is-long-enough";
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.organization.findUnique.mockResolvedValue({ isActive: true });
    audit.recordCritical.mockResolvedValue({ id: 1 });
  });

  function service() {
    return new IdentityService(prisma as any, audit as any);
  }

  function safeRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 10,
      orgId: 1,
      subjectRef: "visitor.demo-001",
      consentGranted: true,
      consentSource: "frontdesk",
      consentPolicyVersion: "identity-v1",
      consentGrantedAt: new Date("2026-10-09T00:00:00.000Z"),
      embeddingFingerprint: "abc123",
      embeddingSchemaVersion: 1,
      status: "ACTIVE",
      retentionExpiresAt: new Date("2027-10-09T00:00:00.000Z"),
      deletedAt: null,
      deletionReason: null,
      createdByUserId: 7,
      createdAt: new Date("2026-10-09T00:00:00.000Z"),
      updatedAt: new Date("2026-10-09T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("rejects identity records without explicit granted consent", async () => {
    await expect(
      service().create(
        1,
        {
          subjectRef: "visitor.demo-001",
          consent: {
            granted: false,
            source: "frontdesk",
            policyVersion: "identity-v1",
            grantedAt: "2026-10-09T00:00:00.000Z",
          },
          embeddingMetadata: { provider: "local", dimensions: 384 },
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.identityEmbeddingRecord.upsert).not.toHaveBeenCalled();
  });

  it.each(["9876543210", "visitor.email@example.com"])(
    "rejects prohibited personal data in subjectRef before persistence: %s",
    async (subjectRef) => {
      await expect(
        service().create(
          1,
          {
            subjectRef,
            consent: {
              granted: true,
              source: "frontdesk",
              policyVersion: "identity-v1",
              grantedAt: "2026-10-09T00:00:00.000Z",
            },
            embeddingMetadata: { provider: "local", dimensions: 384 },
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.identityEmbeddingRecord.upsert).not.toHaveBeenCalled();
      expect(audit.recordCritical).not.toHaveBeenCalled();
    },
  );

  it("creates an encrypted embedding record and returns only safe metadata", async () => {
    prisma.identityEmbeddingRecord.upsert.mockImplementation(({ create }) =>
      safeRecord({
        embeddingFingerprint: create.embeddingFingerprint,
      }),
    );

    const result = await service().create(
      1,
      {
        subjectRef: "visitor.demo-001",
        consent: {
          granted: true,
          source: "frontdesk",
          policyVersion: "identity-v1",
          grantedAt: "2026-10-09T00:00:00.000Z",
        },
        embeddingMetadata: { provider: "local", dimensions: 384 },
      },
      actor,
      "cms-76-test",
    );

    expect(prisma.identityEmbeddingRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_subjectRef: { orgId: 1, subjectRef: "visitor.demo-001" } },
        create: expect.objectContaining({
          embeddingCiphertext: expect.stringMatching(/^v1:/),
          embeddingFingerprint: expect.any(String),
          retentionExpiresAt: new Date("2027-10-09T00:00:00.000Z"),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        subjectRef: "visitor.demo-001",
        embedding: expect.objectContaining({
          encrypted: true,
          fingerprint: expect.any(String),
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/embeddingCiphertext|local/);
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "identity_embedding.created",
        targetOrgId: 1,
        correlationId: "cms-76-test",
        metadata: expect.objectContaining({
          subjectRef: "visitor.demo-001",
          consentGranted: true,
          embeddingSchemaVersion: 1,
        }),
      }),
      prisma,
    );
  });

  it("erases encrypted embedding metadata and audits without ciphertext", async () => {
    prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
      safeRecord({ embeddingFingerprint: "abc123" }),
    );
    prisma.identityEmbeddingRecord.update.mockResolvedValue(
      safeRecord({
        embeddingFingerprint: null,
        status: "DELETED",
        deletedAt: new Date("2026-10-09T01:00:00.000Z"),
        deletionReason: "requested_erasure",
      }),
    );

    const result = await service().erase(
      1,
      10,
      { reason: "requested_erasure" },
      actor,
      "cms-76-delete",
    );

    expect(prisma.identityEmbeddingRecord.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        status: "DELETED",
        embeddingCiphertext: null,
        embeddingFingerprint: null,
      }),
    });
    expect(result.embedding.encrypted).toBe(false);
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "identity_embedding.erased",
        metadata: expect.not.objectContaining({
          embeddingCiphertext: expect.anything(),
        }),
      }),
      prisma,
    );
  });

  it("redacts pre-existing unsafe subject refs from responses and audit metadata", async () => {
    prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
      safeRecord({ subjectRef: "9876543210" }),
    );
    prisma.identityEmbeddingRecord.update.mockResolvedValue(
      safeRecord({
        subjectRef: "9876543210",
        embeddingFingerprint: null,
        status: "DELETED",
        deletedAt: new Date("2026-10-09T01:00:00.000Z"),
        deletionReason: "requested_erasure",
      }),
    );

    const result = await service().erase(
      1,
      10,
      { reason: "requested_erasure" },
      actor,
      "cms-76-delete",
    );

    expect(result.subjectRef).toBe("[redacted]");
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "identity_embedding.erased",
        metadata: expect.objectContaining({
          subjectRef: "[redacted]",
        }),
      }),
      prisma,
    );
  });

  it("rejects cross-tenant direct-ID erasure before mutation", async () => {
    prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
      safeRecord({ orgId: 2 }),
    );

    await expect(
      service().erase(1, 10, {}, actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
  });

  it("blocks organization users from another tenant", async () => {
    await expect(
      service().list(2, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.identityEmbeddingRecord.findMany).not.toHaveBeenCalled();
  });

  describe("correct (correction API)", () => {
    it("corrects subjectRef, consent and embedding metadata and re-encrypts payload", async () => {
      prisma.identityEmbeddingRecord.findUnique
        .mockResolvedValueOnce(safeRecord({ id: 10, subjectRef: "visitor.old-001" }))
        .mockResolvedValueOnce(null); // uniqueness check
      prisma.identityEmbeddingRecord.update.mockResolvedValue(
        safeRecord({
          id: 10,
          subjectRef: "visitor.corrected-001",
          consentPolicyVersion: "identity-v2",
          embeddingFingerprint: "new-fingerprint",
        }),
      );

      const result = await service().correct(
        1,
        10,
        {
          subjectRef: "visitor.corrected-001",
          consent: {
            granted: true,
            source: "frontdesk-kiosk",
            policyVersion: "identity-v2",
            grantedAt: "2026-10-10T00:00:00.000Z",
          },
          embeddingMetadata: { provider: "local", dimensions: 512 },
        },
        actor,
        "cms-79-correct",
      );

      expect(prisma.identityEmbeddingRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            subjectRef: "visitor.corrected-001",
            consentGranted: true,
            consentSource: "frontdesk-kiosk",
            consentPolicyVersion: "identity-v2",
            embeddingCiphertext: expect.stringMatching(/^v1:/),
            embeddingFingerprint: expect.any(String),
            embeddingSchemaVersion: 1,
          }),
        }),
      );
      expect(result.subjectRef).toBe("visitor.corrected-001");
      expect(audit.recordCritical).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "identity_embedding.corrected",
          targetType: "identity_embedding",
          targetId: 10,
          targetOrgId: 1,
          correlationId: "cms-79-correct",
        }),
        prisma,
      );
    });

    it("restores a REVOKED record to ACTIVE when valid consent and embedding are corrected", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({
          id: 10,
          status: "REVOKED",
          consentGranted: false,
          embeddingFingerprint: null,
          embeddingCiphertext: null,
        }),
      );
      prisma.identityEmbeddingRecord.update.mockResolvedValue(
        safeRecord({
          id: 10,
          status: "ACTIVE",
          consentGranted: true,
          embeddingFingerprint: "restored-fp",
        }),
      );

      const result = await service().correct(
        1,
        10,
        {
          consent: {
            granted: true,
            source: "frontdesk",
            policyVersion: "identity-v1",
            grantedAt: "2026-10-10T00:00:00.000Z",
          },
          embeddingMetadata: { provider: "local", dimensions: 384 },
        },
        actor,
      );

      expect(prisma.identityEmbeddingRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "ACTIVE",
            consentGranted: true,
          }),
        }),
      );
      expect(result.status).toBe("ACTIVE");
    });

    it("rejects empty correction payload", async () => {
      await expect(
        service().correct(1, 10, {}, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects correcting an erased record", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ status: "DELETED", deletedAt: new Date() }),
      );

      await expect(
        service().correct(1, 10, { subjectRef: "visitor.demo-002" }, actor),
      ).rejects.toThrow("Cannot correct an erased identity record");
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects duplicate subjectRef in the same organization", async () => {
      prisma.identityEmbeddingRecord.findUnique
        .mockResolvedValueOnce(safeRecord({ id: 10, subjectRef: "visitor.original" }))
        .mockResolvedValueOnce(safeRecord({ id: 99, subjectRef: "visitor.duplicate" }));

      await expect(
        service().correct(1, 10, { subjectRef: "visitor.duplicate" }, actor),
      ).rejects.toThrow("Identity subject reference already exists in organization");
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects prohibited personal data in correction subjectRef", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10, subjectRef: "visitor.old" }),
      );

      await expect(
        service().correct(1, 10, { subjectRef: "+12345678901" }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects cross-tenant direct-ID correction", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10, orgId: 2 }),
      );

      await expect(
        service().correct(1, 10, { subjectRef: "visitor.new" }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects correction for inactive organization", async () => {
      prisma.organization.findUnique.mockResolvedValue({ isActive: false });

      await expect(
        service().correct(1, 10, { subjectRef: "visitor.new" }, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });
  });

  describe("revokeConsent (revoke-consent API)", () => {
    it("revokes consent, marks status REVOKED, clears ciphertext and fingerprint, and audits", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10, embeddingFingerprint: "fp-123" }),
      );
      prisma.identityEmbeddingRecord.update.mockResolvedValue(
        safeRecord({
          id: 10,
          consentGranted: false,
          status: "REVOKED",
          embeddingFingerprint: null,
        }),
      );

      const result = await service().revokeConsent(
        1,
        10,
        { reason: "withdrawn_by_subject" },
        actor,
        "cms-79-revoke",
      );

      expect(prisma.identityEmbeddingRecord.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          consentGranted: false,
          status: "REVOKED",
          embeddingCiphertext: null,
          embeddingFingerprint: null,
        }),
      });
      expect(result.consent.granted).toBe(false);
      expect(result.status).toBe("REVOKED");
      expect(result.embedding.encrypted).toBe(false);
      expect(audit.recordCritical).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "identity_embedding.consent_revoked",
          targetType: "identity_embedding",
          targetId: 10,
          targetOrgId: 1,
          correlationId: "cms-79-revoke",
          metadata: expect.objectContaining({
            consentGranted: false,
            status: "REVOKED",
            reason: "withdrawn_by_subject",
          }),
        }),
        prisma,
      );
    });

    it("rejects revoking consent for an erased record", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10, status: "DELETED", deletedAt: new Date() }),
      );

      await expect(
        service().revokeConsent(1, 10, {}, actor),
      ).rejects.toThrow("Cannot revoke consent for an erased identity record");
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects cross-tenant direct-ID consent revocation", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10, orgId: 2 }),
      );

      await expect(
        service().revokeConsent(1, 10, {}, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects consent revocation for inactive organization", async () => {
      prisma.organization.findUnique.mockResolvedValue({ isActive: false });

      await expect(
        service().revokeConsent(1, 10, {}, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects prohibited data in revocation reason", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10 }),
      );

      await expect(
        service().revokeConsent(1, 10, { reason: "test@example.com requested" }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });
  });

  describe("erase (delete API)", () => {
    it("successfully erases a REVOKED record", async () => {
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(
        safeRecord({ id: 10, status: "REVOKED", consentGranted: false, embeddingFingerprint: null }),
      );
      prisma.identityEmbeddingRecord.update.mockResolvedValue(
        safeRecord({
          id: 10,
          status: "DELETED",
          deletedAt: new Date(),
          deletionReason: "final_deletion",
        }),
      );

      const result = await service().erase(1, 10, { reason: "final_deletion" }, actor);

      expect(prisma.identityEmbeddingRecord.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          status: "DELETED",
          deletionReason: "final_deletion",
        }),
      });
      expect(result.status).toBe("DELETED");
    });
  });
});
