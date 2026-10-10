import { ConfigService } from "@nestjs/config";

const SAFE_ALIAS_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export type SafeAiProviderReference = {
  schemaVersion: 1;
  gateway: "cms-ai-gateway";
  providerAlias: string;
  modelAlias: string;
  policyVersion: string;
  directProviderAccess: false;
};

type ConfigReader = Pick<ConfigService, "get">;

function safeAlias(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return SAFE_ALIAS_PATTERN.test(trimmed) ? trimmed : fallback;
}

export function safeAiProviderReference(
  config?: ConfigReader | null,
): SafeAiProviderReference {
  return {
    schemaVersion: 1,
    gateway: "cms-ai-gateway",
    providerAlias: safeAlias(
      config?.get<string>("AI_GATEWAY_PROVIDER_ALIAS") ??
        config?.get<string>("AI_PROVIDER_ALIAS"),
      "cms-ai-provider",
    ),
    modelAlias: safeAlias(
      config?.get<string>("AI_GATEWAY_MODEL_ALIAS") ??
        config?.get<string>("AI_PROVIDER_MODEL_ALIAS"),
      "default-conversation-model",
    ),
    policyVersion: safeAlias(
      config?.get<string>("AI_GATEWAY_POLICY_VERSION") ??
        config?.get<string>("AI_PROVIDER_POLICY_VERSION"),
      "ai-provider-policy-v1",
    ),
    directProviderAccess: false,
  };
}
