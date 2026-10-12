import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LicenseStatus } from "@prisma/client";
import { AiProviderClient } from "./ai-provider.client";
import { AiGatewayService } from "./ai-gateway.service";
import { AiToolRegistryService } from "./ai-tool-registry.service";
import { redactText, redactValue } from "./ai-redaction";

function buildRobot(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    orgId: 1,
    validUntil: new Date("2099-01-01T00:00:00.000Z"),
    revokedAt: null,
    licenseStatus: LicenseStatus.ACTIVE,
    hardwareCapabilities: null,
    org: {
      id: 1,
      name: "Demo School",
      isActive: true,
      logoUrl: "https://assets.whizrobo.test/logo.png",
      primaryColor: "#1D4ED8",
      secondaryColor: "#F97316",
      tenantVersion: 4,
    },
    ...overrides,
  };
}

describe("AI gateway redaction", () => {
  it("keeps dates and times while redacting phone numbers and emails", () => {
    expect(redactText("Your meeting is on 2026-10-12 at 10:30-11:00.")).toBe(
      "Your meeting is on 2026-10-12 at 10:30-11:00.",
    );
    expect(redactText("Booked for 2026-10-12 10:30")).toBe("Booked for 2026-10-12 10:30");
    expect(redactText("Call +91 98765 43210 or 9876543210")).toBe(
      "Call [REDACTED] or [REDACTED]",
    );
    expect(redactText("Mail a@b.com")).toBe("Mail [REDACTED]");
  });

  it("redacts secrets and prohibited PII from text and structured values", () => {
    expect(
      redactText("call +91 99999 99999 with WHRB123456 and Bearer abc.def.ghi"),
    ).not.toMatch(/99999|WHRB123456|Bearer/);

    expect(
      redactValue({
        apiKey: "sk-live-secret",
        message: "email test@example.com",
        nested: { refreshToken: "jwt", value: "ok" },
      }),
    ).toEqual({
      message: "email [REDACTED]",
      nested: { value: "ok" },
    });
  });
});

describe("AiProviderClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("returns a safe fallback when provider configuration is absent", async () => {
    const client = new AiProviderClient({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    const result = await client.complete([{ role: "user", content: "hello" }]);

    expect(result).toEqual(
      expect.objectContaining({
        fallback: true,
        reason: "PROVIDER_NOT_CONFIGURED",
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/apiKey|secret|token/i);
  });

  it("returns only safe provider aliases for robot-facing contracts", () => {
    const client = new AiProviderClient({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AI_PROVIDER_BASE_URL: "https://provider.example/v1",
          AI_PROVIDER_API_KEY: "sk-test-secret-value",
          AI_PROVIDER_MODEL: "real-provider-model",
          AI_PROVIDER_ALIAS: "cms-ai-provider",
          AI_PROVIDER_MODEL_ALIAS: "conversation-standard",
          AI_PROVIDER_POLICY_VERSION: "ai-provider-policy-v2",
        };
        return values[key];
      }),
    } as unknown as ConfigService);

    const reference = client.safeReference();

    expect(reference).toEqual({
      schemaVersion: 1,
      gateway: "cms-ai-gateway",
      providerAlias: "cms-ai-provider",
      modelAlias: "conversation-standard",
      policyVersion: "ai-provider-policy-v2",
      directProviderAccess: false,
    });
    expect(JSON.stringify(reference)).not.toMatch(
      /sk-test-secret-value|provider\.example|real-provider-model/,
    );
  });

  it("retries provider failures and returns a sanitized fallback", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network down"));
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AI_PROVIDER_BASE_URL: "https://provider.example/v1",
          AI_PROVIDER_API_KEY: "sk-test-secret-value",
          AI_PROVIDER_MODEL: "test-model",
          AI_PROVIDER_MAX_RETRIES: "1",
          AI_PROVIDER_TIMEOUT_MS: "1000",
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const client = new AiProviderClient(config);

    const result = await client.complete([{ role: "user", content: "hello" }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/sk-test-secret-value/);
  });

  it("does not send input beyond the configured limit to the provider", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AI_PROVIDER_BASE_URL: "https://provider.example/v1",
          AI_PROVIDER_API_KEY: "sk-test-secret-value",
          AI_PROVIDER_MODEL: "test-model",
          AI_PROVIDER_MAX_INPUT_CHARS: "4",
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const client = new AiProviderClient(config);

    const result = await client.complete([{ role: "user", content: "too-long" }]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ reason: "INPUT_LIMIT" }));
  });

  it("does not send requests that exceed configured estimated cost limit", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AI_PROVIDER_BASE_URL: "https://provider.example/v1",
          AI_PROVIDER_API_KEY: "sk-test-secret-value",
          AI_PROVIDER_MODEL: "test-model",
          AI_PROVIDER_MAX_OUTPUT_TOKENS: "1000",
          AI_PROVIDER_MAX_ESTIMATED_COST_MICRO_USD: "1",
          AI_PROVIDER_INPUT_COST_MICRO_USD_PER_1K_TOKENS: "1000",
          AI_PROVIDER_OUTPUT_COST_MICRO_USD_PER_1K_TOKENS: "1000",
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const client = new AiProviderClient(config);

    const result = await client.complete([{ role: "user", content: "hello" }]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ reason: "COST_LIMIT" }));
  });

  it("sends configured max output tokens to the provider", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      ),
    );
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AI_PROVIDER_BASE_URL: "https://provider.example/v1",
          AI_PROVIDER_API_KEY: "sk-test-secret-value",
          AI_PROVIDER_MODEL: "test-model",
          AI_PROVIDER_MAX_OUTPUT_TOKENS: "128",
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const client = new AiProviderClient(config);

    await client.complete([{ role: "user", content: "hello" }]);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(
      expect.objectContaining({ max_tokens: 128 }),
    );
  });

  it("aborts provider calls after the configured timeout", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AI_PROVIDER_BASE_URL: "https://provider.example/v1",
          AI_PROVIDER_API_KEY: "sk-test-secret-value",
          AI_PROVIDER_MODEL: "test-model",
          AI_PROVIDER_MAX_RETRIES: "0",
          AI_PROVIDER_TIMEOUT_MS: "1000",
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const client = new AiProviderClient(config);

    const result = await client.complete([{ role: "user", content: "hello" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({ reason: "PROVIDER_TIMEOUT" }),
    );
  });
});

describe("AiToolRegistryService", () => {
  const prisma = {
    robot: {
      findUnique: jest.fn(),
    },
    orgPermission: {
      findMany: jest.fn(),
    },
  };
  const entitlements = {
    resolveCapabilityKeys: jest.fn(),
  };
  const audit = {
    recordBestEffort: jest.fn(),
  };
  let service: AiToolRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiToolRegistryService(
      prisma as any,
      entitlements as any,
      audit as any,
    );
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.orgPermission.findMany.mockResolvedValue([
      { permission: { key: "ai.conversation" } },
    ]);
    entitlements.resolveCapabilityKeys.mockResolvedValue(
      new Set(["ai.conversation"]),
    );
  });

  it("rejects unregistered tool calls with sanitized audit metadata", async () => {
    await expect(
      service.execute({
        robotId: 10,
        orgId: 1,
        name: "readDatabase",
        arguments: { licenseKey: "WHRB123456", query: "select *" },
        correlationId: "cms-69-test",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.tool.rejected",
        metadata: expect.objectContaining({
          reason: "UNREGISTERED_TOOL",
          toolName: "readDatabase",
          arguments: { query: "select *" },
        }),
      }),
    );
  });

  it("returns approved organization context for authorized capability scope", async () => {
    const result = await service.execute({
      robotId: 10,
      orgId: 1,
      name: "getApprovedOrganisationInformation",
      arguments: {},
    });

    expect(result).toEqual({
      orgId: 1,
      orgName: "Demo School",
      displayName: "Demo School",
      logoUrl: "https://assets.whizrobo.test/logo.png",
      primaryColor: "#1D4ED8",
      secondaryColor: "#F97316",
      tenantVersion: 4,
      cacheVersion: "org-1-v4",
    });
  });

  it("rejects registered tools when effective capability is missing", async () => {
    entitlements.resolveCapabilityKeys.mockResolvedValue(new Set());

    await expect(
      service.execute({
        robotId: 10,
        orgId: 1,
        name: "getApprovedOrganisationInformation",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.tool.rejected",
        metadata: expect.objectContaining({ reason: "CAPABILITY_DENIED" }),
      }),
    );
  });

  it("rejects registered tools when organization permission is missing", async () => {
    prisma.orgPermission.findMany.mockResolvedValue([]);

    await expect(
      service.execute({
        robotId: 10,
        orgId: 1,
        name: "getApprovedOrganisationInformation",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.tool.rejected",
        metadata: expect.objectContaining({ reason: "PERMISSION_DENIED" }),
      }),
    );
    expect(entitlements.resolveCapabilityKeys).not.toHaveBeenCalled();
  });

  it("rejects requestMovement unless movement capability is effective", async () => {
    await expect(
      service.execute({
        robotId: 10,
        orgId: 1,
        name: "requestMovement",
        arguments: { direction: "forward", token: "secret" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.orgPermission.findMany.mockResolvedValue([
      { permission: { key: "ai.conversation" } },
      { permission: { key: "robot.movement.request" } },
    ]);
    entitlements.resolveCapabilityKeys.mockResolvedValue(
      new Set(["ai.conversation", "robot.movement.request"]),
    );

    const result = await service.execute({
      robotId: 10,
      orgId: 1,
      name: "requestMovement",
      arguments: { direction: "forward", token: "secret" },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "requires_approval",
      }),
    );
    expect(audit.recordBestEffort).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "ai.tool.movement_requested",
        metadata: expect.objectContaining({
          arguments: { direction: "forward" },
        }),
      }),
    );
  });
});

describe("AiGatewayService", () => {
  it("sends tool results back to the provider and speaks the second answer", async () => {
    const provider = {
      complete: jest
        .fn()
        .mockResolvedValueOnce({
          content: "",
          toolCalls: [{ name: "getApprovedOrganisationInformation", arguments: {} }],
        })
        .mockResolvedValueOnce({
          content: "[[scope:in]] Welcome to Demo School.",
          toolCalls: [],
        }),
    };
    const tools = {
      execute: jest.fn().mockResolvedValue({ orgName: "Demo School" }),
    };
    const audit = { recordBestEffort: jest.fn() };
    const service = new AiGatewayService(provider as any, tools as any, audit as any);

    const result: any = await service.converse({
      robotId: 10,
      orgId: 1,
      correlationId: "tool-round",
      body: { message: "Which school is this?", inputMode: "speech" },
    });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    const secondMessages = provider.complete.mock.calls[1][0];
    const toolMessage = secondMessages.find((m: any) => m.role === "tool");
    expect(toolMessage.content).toContain("Demo School");
    expect(result.message).toBe("Welcome to Demo School.");
    expect(result.toolResults[0]).toEqual(
      expect.objectContaining({ name: "getApprovedOrganisationInformation", status: "completed" }),
    );
    expect(result.outOfContext).toBe(false);
  });

  function refusePolicyConfig() {
    return {
      resolveForRobot: jest.fn().mockResolvedValue({
        personaName: "Campus Guide",
        approvedContext: { contexts: [], approvedQa: [] },
        policies: { outOfContext: { action: "refuse" } },
      }),
    };
  }

  it("refuses only when the model tags the answer out of scope under a refuse policy", async () => {
    const provider = {
      complete: jest.fn().mockResolvedValue({
        content: "[[scope:out]] The cricket score is 250.",
        toolCalls: [],
      }),
    };
    const service = new AiGatewayService(
      provider as any,
      { execute: jest.fn() } as any,
      { recordBestEffort: jest.fn() } as any,
      refusePolicyConfig() as any,
    );

    const result: any = await service.converse({
      robotId: 10,
      orgId: 1,
      body: { message: "Who won the cricket match?", inputMode: "speech" },
    });

    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(result.message).toBe(
      "I can only answer questions using the approved event and organization information.",
    );
    expect(result.outOfContext).toBe(true);
    expect(result.policyAction).toBe("refuse");
  });

  it("never refuses on the keyword guess alone; the model's in-scope answer is spoken", async () => {
    const provider = {
      complete: jest.fn().mockResolvedValue({
        content: "[[scope:in]] This is the main campus library.",
        toolCalls: [],
      }),
    };
    const service = new AiGatewayService(
      provider as any,
      { execute: jest.fn() } as any,
      { recordBestEffort: jest.fn() } as any,
      refusePolicyConfig() as any,
    );

    const result: any = await service.converse({
      robotId: 10,
      orgId: 1,
      body: { message: "Which building is this?", inputMode: "speech" },
    });

    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(result.message).toBe("This is the main campus library.");
    expect(result.outOfContext).toBe(false);
    expect(result.policyAction).toBe("answer");
  });

  it("never streams the hidden scope tag", async () => {
    async function* stream() {
      yield { type: "sentence", text: "[[scope:in]] Welcome to the campus." };
      yield { type: "sentence", text: "How can I help?" };
      yield { type: "done", fallback: false, toolCalls: [] };
    }
    const provider = { streamComplete: jest.fn().mockReturnValue(stream()) };
    const service = new AiGatewayService(
      provider as any,
      { execute: jest.fn() } as any,
      { recordBestEffort: jest.fn() } as any,
      refusePolicyConfig() as any,
    );

    const events: any[] = [];
    for await (const event of service.streamEvents({
      robotId: 10,
      orgId: 1,
      body: { message: "Hello there", inputMode: "speech" },
    })) {
      events.push(event);
    }

    const sentences = events.filter((e) => e.type === "sentence").map((e) => e.data.text);
    expect(sentences).toEqual(["Welcome to the campus.", "How can I help?"]);
    expect(JSON.stringify(events)).not.toContain("[[scope");
    expect(events[events.length - 1].data).toEqual(
      expect.objectContaining({ outOfContext: false, policyAction: "answer" }),
    );
  });

  it("redacts prompt metadata before audit and returns provider fallback safely", async () => {
    const provider = {
      complete: jest.fn().mockResolvedValue({
        content: "Cannot call +91 99999 99999",
        toolCalls: [],
        fallback: true,
        reason: "PROVIDER_TIMEOUT",
      }),
    };
    const tools = { execute: jest.fn() };
    const audit = { recordBestEffort: jest.fn() };
    const service = new AiGatewayService(provider as any, tools as any, audit as any);

    const result = await service.converse({
      robotId: 10,
      orgId: 1,
      correlationId: "cms-69-test",
      body: {
        message: "My license is WHRB123456 and email is test@example.com",
        inputMode: "text",
        contextReferences: { accessToken: "secret", courseId: 1 },
      },
    });

    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.conversation.requested",
        metadata: expect.objectContaining({
          messageLength: "My license is [REDACTED] and email is [REDACTED]".length,
          contextReferences: { courseId: 1 },
        }),
      }),
    );
    expect(JSON.stringify(audit.recordBestEffort.mock.calls)).not.toContain("My license is");
    expect(result).toEqual(
      expect.objectContaining({
        fallback: true,
        fallbackReason: "PROVIDER_TIMEOUT",
        message: "Cannot call [REDACTED]",
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/WHRB123456|test@example.com/);
  });
});
