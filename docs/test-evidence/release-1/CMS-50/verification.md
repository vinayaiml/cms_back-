# CMS-50 Verification - Optional Per-User Capability Assignments

## Scope

CMS-50 adds optional per-user capability assignments and validates that a user receives only the intersection of enabled user assignments and the organization-effective capability set.

## Expected Behavior

- Authorized admins can assign one active, organization-permitted capability to a target user.
- Cross-tenant and unauthorized assignment attempts are rejected before mutation.
- Disabled user assignments, inactive organizations, expired subscriptions and organization-level DENY overrides remove capabilities from the effective user set.
- Assignment limits are validated and secret-like keys or values are rejected before persistence.
- Assignment writes increment the organization tenant version and create sanitized audit metadata.
- Responses do not include license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Verification Commands

```text
npm run prisma:generate
npm run build
npm run test:unit
npx @redocly/cli@latest lint docs/api/openapi.yaml
git diff --check
```

## Results

PASS.

- `npm run prisma:generate` passed.
- `npm run build` passed.
- `npm run test:unit` passed: 22 suites, 142 tests.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing warnings only.
- `git diff --check` passed.
- OpenAPI SHA-256: `640F80411088B5696EFF4B5328D07A84183D87B6BF9D7DA87C8B737090F732EF`.
