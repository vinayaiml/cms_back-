import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConversationConfigService } from "./conversation-config.service";

describe("ConversationConfigService", () => {
  const prisma = {
    organizationConversationConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    robotConversationConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    organizationConversationContext: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    organizationApprovedQa: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    conversationPublicationRevision: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    robot: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  const actor = { userId: 7, orgId: 1, isSuperAdmin: false };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.organization.findUnique.mockResolvedValue({ isActive: true });
    prisma.organization.update.mockResolvedValue({ tenantVersion: 3 });
    prisma.conversationPublicationRevision.create.mockImplementation(
      ({ data }) => ({
        id: 100,
        ...data,
        createdAt: new Date("2026-10-08T00:00:00.000Z"),
      }),
    );
  });

  function service() {
    return new ConversationConfigService(prisma as any, audit as any);
  }

  it("resolves robot-specific published override over organization default", async () => {
    prisma.robot.findUnique.mockResolvedValue({
      id: 10,
      orgId: 1,
      org: {
        id: 1,
        name: "Demo School",
        conversationConfig: {
          id: 1,
          personaName: "Org Persona",
          personaPrompt: "Use org prompt.",
          greetingText: "Welcome from org",
          voiceStyle: "calm",
          language: "en",
          tone: "formal",
          defaultLanguage: "en-IN",
          supportedLanguages: ["en-IN", "hi-IN"],
          speechSpeed: 0.9,
          sessionMaxSeconds: 900,
          sessionIdleTimeoutSeconds: 180,
          cooldownSeconds: 10,
          dailySessionLimit: 25,
          isPublished: true,
          version: 4,
          publishedAt: new Date("2026-10-01T00:00:00.000Z"),
          updatedAt: new Date("2026-10-01T00:00:00.000Z"),
        },
        conversationContexts: [
          {
            id: 3,
            stableKey: "event.schedule",
            contextType: "EVENT",
            title: "Science Expo",
            body: "The expo starts at 10 AM in Hall A.",
            isPublished: true,
            version: 5,
            publishedAt: new Date("2026-10-03T00:00:00.000Z"),
            updatedAt: new Date("2026-10-03T00:00:00.000Z"),
          },
        ],
        approvedQas: [
          {
            id: 4,
            stableKey: "parking",
            question: "Where is parking?",
            answer: "Visitor parking is near Gate 2.",
            isPublished: true,
            version: 6,
            publishedAt: new Date("2026-10-04T00:00:00.000Z"),
            updatedAt: new Date("2026-10-04T00:00:00.000Z"),
          },
        ],
      },
      conversationConfig: {
        id: 2,
        personaName: "Robot Persona",
        personaPrompt: null,
        greetingText: "Welcome from robot",
        voiceStyle: null,
        language: null,
        tone: "playful",
        defaultLanguage: null,
        supportedLanguages: null,
        speechSpeed: 1.2,
        sessionMaxSeconds: null,
        sessionIdleTimeoutSeconds: null,
        cooldownSeconds: 15,
        dailySessionLimit: null,
        isPublished: true,
        version: 2,
        publishedAt: new Date("2026-10-02T00:00:00.000Z"),
        updatedAt: new Date("2026-10-02T00:00:00.000Z"),
      },
    });

    await expect(service().resolveForRobot(10)).resolves.toEqual(
      expect.objectContaining({
        source: "robotOverride",
        orgId: 1,
        robotId: 10,
        personaName: "Robot Persona",
        personaPrompt: "Use org prompt.",
        greetingText: "Welcome from robot",
        voiceStyle: "calm",
        language: "en",
        tone: "playful",
        version: {
          organization: 4,
          robot: 2,
          effective: "conversation-org-1-v4-robot-10-v2",
        },
        approvedContext: {
          schemaVersion: 1,
          version: {
            context: 5,
            qa: 6,
            effective: "approved-context-v5-qa-v6",
          },
          contexts: [
            expect.objectContaining({
              stableKey: "event.schedule",
              body: "The expo starts at 10 AM in Hall A.",
            }),
          ],
          approvedQa: [
            expect.objectContaining({
              stableKey: "parking",
              answer: "Visitor parking is near Gate 2.",
            }),
          ],
        },
        policies: {
          schemaVersion: 1,
          language: {
            default: "en-IN",
            supported: ["en-IN", "hi-IN"],
          },
          speech: {
            speed: 1.2,
          },
          session: {
            maxSeconds: 900,
            idleTimeoutSeconds: 180,
            dailyLimit: 25,
          },
          cooldown: {
            seconds: 15,
          },
        },
      }),
    );
  });

  it("rejects cross-tenant robot direct-ID access before mutation", async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 10, orgId: 2 });

    await expect(
      service().upsertRobotConfig(
        10,
        { greetingText: "Hello", publish: true },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robotConversationConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects secrets and prohibited PII in published settings", async () => {
    await expect(
      service().upsertOrgConfig(
        1,
        { greetingText: "Call +91 99999 99999", publish: true },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.organizationConversationConfig.upsert).not.toHaveBeenCalled();
  });

  it("writes sanitized audit metadata and bumps tenant version on publish", async () => {
    prisma.organizationConversationConfig.findUnique.mockResolvedValue(null);
    prisma.organizationConversationConfig.upsert.mockResolvedValue({
      id: 1,
      personaName: "Guide",
      personaPrompt: "Use approved context.",
      greetingText: "Hello",
      voiceStyle: "warm",
      language: "en",
      tone: "helpful",
      defaultLanguage: "en-IN",
      supportedLanguages: ["en-IN", "hi-IN"],
      speechSpeed: 1.1,
      sessionMaxSeconds: 600,
      sessionIdleTimeoutSeconds: 120,
      cooldownSeconds: 5,
      dailySessionLimit: 40,
      isPublished: true,
      version: 1,
      publishedAt: new Date("2026-10-07T00:00:00.000Z"),
      updatedAt: new Date("2026-10-07T00:00:00.000Z"),
    });

    await service().upsertOrgConfig(
      1,
      {
        personaName: "Guide",
        greetingText: "Hello",
        defaultLanguage: "en-IN",
        supportedLanguages: ["en-IN", "hi-IN"],
        speechSpeed: 1.1,
        sessionMaxSeconds: 600,
        sessionIdleTimeoutSeconds: 120,
        cooldownSeconds: 5,
        dailySessionLimit: 40,
        publish: true,
      },
      actor,
      "cms-72-test",
    );

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { tenantVersion: { increment: 1 } },
      select: { tenantVersion: true },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation_config.organization_upserted",
        targetOrgId: 1,
        correlationId: "cms-72-test",
        metadata: expect.objectContaining({
          isPublished: true,
          version: 1,
          changedFields: [
            "personaName",
            "greetingText",
            "defaultLanguage",
            "supportedLanguages",
            "speechSpeed",
            "sessionMaxSeconds",
            "sessionIdleTimeoutSeconds",
            "cooldownSeconds",
            "dailySessionLimit",
          ],
        }),
      }),
      prisma,
    );
    expect(prisma.conversationPublicationRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 1,
        scope: "organization",
        sourceType: "organization_config",
        version: 1,
        previousVersion: null,
        snapshot: expect.objectContaining({
          personaName: "Guide",
          greetingText: "Hello",
          supportedLanguages: ["en-IN", "hi-IN"],
        }),
      }),
    });
    expect(JSON.stringify(audit.recordCritical.mock.calls[0][0])).not.toMatch(
      /Guide|Hello|personaPrompt/,
    );
  });

  it("lists publication revision metadata without returning stored snapshots", async () => {
    prisma.conversationPublicationRevision.findMany.mockResolvedValue([
      {
        id: 20,
        orgId: 1,
        robotId: null,
        scope: "organization",
        sourceType: "organization_config",
        sourceId: 1,
        stableKey: null,
        version: 2,
        previousVersion: 1,
        snapshot: { personaPrompt: "Do not expose this body" },
        publishedByUserId: 7,
        publishedAt: new Date("2026-10-08T01:00:00.000Z"),
        restoredFromRevisionId: null,
        createdAt: new Date("2026-10-08T01:00:01.000Z"),
      },
    ]);

    await expect(service().listPublicationRevisions(1, actor)).resolves.toEqual([
      expect.not.objectContaining({ snapshot: expect.anything() }),
    ]);
  });

  it("restores an earlier organization publication revision and audits sanitized metadata", async () => {
    prisma.conversationPublicationRevision.findUnique.mockResolvedValueOnce({
      id: 20,
      orgId: 1,
      robotId: null,
      scope: "organization",
      sourceType: "organization_config",
      sourceId: 1,
      stableKey: null,
      version: 2,
      previousVersion: 1,
      snapshot: {
        personaName: "Guide",
        personaPrompt: "Use approved context.",
        greetingText: "Welcome back",
        voiceStyle: "warm",
        language: "en",
        tone: "helpful",
        defaultLanguage: "en-IN",
        supportedLanguages: ["en-IN"],
        speechSpeed: 1,
        sessionMaxSeconds: 600,
        sessionIdleTimeoutSeconds: 120,
        cooldownSeconds: 5,
        dailySessionLimit: 40,
      },
      publishedByUserId: 7,
      publishedAt: new Date("2026-10-08T01:00:00.000Z"),
      restoredFromRevisionId: null,
      createdAt: new Date("2026-10-08T01:00:01.000Z"),
    });
    prisma.organizationConversationConfig.findUnique.mockResolvedValueOnce({
      version: 4,
    });
    prisma.organizationConversationConfig.upsert.mockResolvedValueOnce({
      id: 1,
      personaName: "Guide",
      personaPrompt: "Use approved context.",
      greetingText: "Welcome back",
      voiceStyle: "warm",
      language: "en",
      tone: "helpful",
      defaultLanguage: "en-IN",
      supportedLanguages: ["en-IN"],
      speechSpeed: 1,
      sessionMaxSeconds: 600,
      sessionIdleTimeoutSeconds: 120,
      cooldownSeconds: 5,
      dailySessionLimit: 40,
      isPublished: true,
      version: 5,
      publishedAt: new Date("2026-10-08T02:00:00.000Z"),
      updatedAt: new Date("2026-10-08T02:00:00.000Z"),
    });

    const result = await service().restorePublicationRevision(
      1,
      20,
      actor,
      "cms-75-test",
    );

    expect(result.restored).toEqual(
      expect.objectContaining({ version: 5, greetingText: "Welcome back" }),
    );
    expect(prisma.conversationPublicationRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 1,
        sourceType: "organization_config",
        version: 5,
        previousVersion: 4,
        restoredFromRevisionId: 20,
      }),
    });
    expect(audit.recordCritical).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "conversation_publication.restored",
        targetOrgId: 1,
        correlationId: "cms-75-test",
        metadata: expect.objectContaining({
          restoredRevisionId: 20,
          restoredVersion: 2,
          newVersion: 5,
        }),
      }),
      prisma,
    );
    expect(JSON.stringify(audit.recordCritical.mock.calls)).not.toMatch(
      /Welcome back|Use approved context/,
    );
  });

  it("rejects cross-tenant publication restore before mutation", async () => {
    prisma.conversationPublicationRevision.findUnique.mockResolvedValueOnce({
      id: 20,
      orgId: 2,
      robotId: null,
      scope: "organization",
      sourceType: "organization_config",
      sourceId: 1,
      stableKey: null,
      version: 1,
      previousVersion: null,
      snapshot: {},
      publishedByUserId: 7,
      publishedAt: new Date("2026-10-08T01:00:00.000Z"),
      restoredFromRevisionId: null,
      createdAt: new Date("2026-10-08T01:00:01.000Z"),
    });

    await expect(
      service().restorePublicationRevision(1, 20, actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.organizationConversationConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects conversation policy values outside safe ranges", async () => {
    await expect(
      service().upsertOrgConfig(
        1,
        { speechSpeed: 2.5, publish: true },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service().upsertOrgConfig(
        1,
        { sessionMaxSeconds: 30, publish: true },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service().upsertOrgConfig(
        1,
        { defaultLanguage: "english", publish: true },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.organizationConversationConfig.upsert).not.toHaveBeenCalled();
  });

  it("upserts approved event context with sanitized audit metadata", async () => {
    prisma.organizationConversationContext.findUnique.mockResolvedValue(null);
    prisma.organizationConversationContext.upsert.mockResolvedValue({
      id: 9,
      stableKey: "event.schedule",
      contextType: "EVENT",
      title: "Science Expo",
      body: "The expo opens at 10 AM.",
      isPublished: true,
      version: 1,
      publishedAt: new Date("2026-10-07T00:00:00.000Z"),
      updatedAt: new Date("2026-10-07T00:00:00.000Z"),
    });

    await service().upsertOrgContext(
      1,
      {
        stableKey: "event.schedule",
        contextType: "EVENT",
        title: "Science Expo",
        body: "The expo opens at 10 AM.",
        publish: true,
      },
      actor,
      "cms-71-test",
    );

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { tenantVersion: { increment: 1 } },
      select: { tenantVersion: true },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation_context.upserted",
        targetOrgId: 1,
        correlationId: "cms-71-test",
        metadata: expect.objectContaining({
          stableKey: "event.schedule",
          contextType: "EVENT",
          isPublished: true,
          version: 1,
        }),
      }),
      prisma,
    );
    expect(JSON.stringify(audit.recordCritical.mock.calls[0][0])).not.toMatch(
      /Science Expo|10 AM/,
    );
  });

  it("rejects prohibited PII in approved Q&A", async () => {
    await expect(
      service().upsertApprovedQa(
        1,
        {
          stableKey: "contact",
          question: "How do I call?",
          answer: "Call +91 99999 99999",
          publish: true,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.organizationApprovedQa.upsert).not.toHaveBeenCalled();
  });
});
