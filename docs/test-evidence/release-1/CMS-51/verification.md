# CMS-51 Verification - Optional Per-User Capability Assignments

## Scope

CMS-51 validates the optional per-user capability assignment model. This ticket uses the shared per-user capability implementation in the users module: admins can assign user-specific capabilities, and the returned effective capability set is the intersection of user assignments and organization-effective access.

## Expected Behavior

- Authorized admins can assign one active, organization-permitted capability to a target user.
- Cross-tenant, direct-ID and unauthorized attempts are rejected before mutation.
- Disabled user assignments, inactive organizations, expired subscriptions and organization-level DENY overrides remove capabilities from the effective user set.
- The effective capability response returns only permitted capabilities and validated limits.
- Assignment limit keys and values are sanitized; secret-like keys or values are rejected before persistence.
- Assignment writes increment organization tenant version and create sanitized audit metadata.
- Responses do not include license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Covered Files

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260925120000_add_user_capability_assignments/migration.sql`
- `backend/src/modules/users/users.controller.ts`
- `backend/src/modules/users/users.dto.ts`
- `backend/src/modules/users/users.service.ts`
- `backend/src/modules/users/users.service.spec.ts`
- `docs/api/openapi.yaml`
- `docs/api/api.md`

## Verification Commands

```text
npm run prisma:generate
npm run build
npm run test:unit
npx @redocly/cli@latest lint docs/api/openapi.yaml
git diff --check -- <CMS-51 files>
```

## Results

PASS.

- `npm run prisma:generate` passed.
- `npm run build` passed.
- `npm run test:unit` passed: 22 suites, 142 tests.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing warnings only.
- Focused `git diff --check` for CMS-51 files passed.

OpenAPI SHA-256: `640F80411088B5696EFF4B5328D07A84183D87B6BF9D7DA87C8B737090F732EF`.
