# CMS-48 Verification - Organization Capability Overrides

## Scope

CMS-48 adds organization-scoped capability overrides with a required reason and sanitized audit event. Overrides affect only the target organization and are applied to the robot sync paid entitlement set after subscription-plan capabilities are resolved.

## Expected Behavior

- Super Admin can list and upsert overrides for a target organization.
- Organization-scoped users are rejected before direct-ID mutation attempts.
- `ALLOW` adds an active capability to the target organization effective entitlement set.
- `DENY` removes an active capability from the target organization effective entitlement set.
- Inactive or missing capabilities are rejected with the shared safe error schema.
- Override writes increment `tenantVersion` for robot cache reset.
- Override writes create `organization.capability_override.upserted` audit events with actor, target organization, capability stable key, previous/next effect and reason, and correlation ID where provided.
- Responses and audit metadata do not include robot license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Automated Verification

Commands executed from `D:\CMS\backend` and `D:\CMS`:

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/orgs/orgs.service.spec.ts src/modules/orgs/orgs.controller.spec.ts src/modules/robot-sync/robot-sync.service.spec.ts --runInBand --verbose
npm run build
npm run test:unit
npx @redocly/cli@latest lint docs/api/openapi.yaml
git diff --check
```

## Manual Traceability

- API contract: `docs/api/openapi.yaml` documents `GET /orgs/{id}/capability-overrides` and `PUT /orgs/{id}/capability-overrides`.
- Usage guide: `docs/api/api.md` documents request and response examples.
- Unit coverage: org service/controller tests cover successful traceable upsert and unauthorized direct-ID attempts; robot sync service tests cover target-org-only effective entitlement resolution with `ALLOW` and `DENY` overrides.


## Results

- `npm run prisma:generate` passed.
- `npm run build` passed.
- `npm run test:unit` passed: 22 suites, 133 tests.
- Focused CMS-48 org and robot-sync service/controller tests passed.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing repository warnings only.
- `git diff --check` passed.
- OpenAPI SHA-256: `41FABB119BC750A3F6209AF7B9B67D024AD4569EA26A377EF84E6F546482AFDA`.
