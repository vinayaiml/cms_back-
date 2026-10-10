# CMS-74 Verification - Safe Provider Reference Configuration

## Scope

- Added safe robot-facing AI provider reference metadata to the bootstrap manifest under `conversation.provider`.
- The manifest exposes only aliases and policy metadata:
  - `gateway`
  - `providerAlias`
  - `modelAlias`
  - `policyVersion`
  - `directProviderAccess: false`
- Provider URL, provider model and API key remain backend-only `AI_GATEWAY_*` environment values.

## Security Notes

- No provider API key, provider URL, JWT, license key or direct provider endpoint is returned to robots.
- Optional alias env vars are validated as safe aliases:
  - `AI_GATEWAY_PROVIDER_ALIAS`
  - `AI_GATEWAY_MODEL_ALIAS`
  - `AI_GATEWAY_POLICY_VERSION`

## Local Verification

- Suggested checks:
  - `cd D:\CMS_V1\CMS_Back && npm run prisma:generate`
  - `cd D:\CMS_V1\CMS_Back && npm run build`
