# CMS-49 Verification - Per-Robot Capability Assignment and Limits

## Scope

CMS-49 adds per-robot capability assignments with validated parameter limits. Robot sync now returns only capabilities that are both effective for the organization and enabled for the authenticated robot.

## Expected Behavior

- Authorized administrators can list and upsert capability assignments for an accessible robot.
- Direct-ID cross-tenant assignment attempts are rejected before mutation.
- Assigned capability must be active and available in the robot organization effective entitlement set.
- Parameter limits are validated as safe JSON and reject prohibited secret-like keys or values.
- Assignment changes increment organization `tenantVersion` and create `robot.capability_assignment.upserted` audit events.
- Robot sync returns only enabled robot assignments plus validated `limits`.
- Robot sync does not return unassigned org capabilities, denied org capabilities, disabled assignments, license keys, tokens or credential secrets.

## Automated Verification

Commands executed from `D:\CMS\backend` and `D:\CMS`:

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/robots/robots.service.spec.ts src/modules/robots/robots.controller.spec.ts src/modules/robot-sync/robot-sync.service.spec.ts --runInBand --verbose
npm run build
npm run test:unit
npx @redocly/cli@latest lint docs/api/openapi.yaml
git diff --check
```

## Manual Traceability

- Prisma model/migration: `RobotCapabilityAssignment`.
- Admin API: `GET /api/robots/{id}/capability-assignments` and `PUT /api/robots/{id}/capability-assignments`.
- Robot sync contract: `entitlements.paidCapabilities[]` includes assigned capability rows and validated `limits`.
- OpenAPI/API guide: `docs/api/openapi.yaml` and `docs/api/api.md`.


## Results

- `npm run prisma:generate` passed.
- `npm run build` passed.
- `npm run test:unit` passed: 22 suites, 138 tests.
- Focused CMS-49 robot service/controller and robot-sync tests passed: 3 suites, 47 tests.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing repository warnings only.
- `git diff --check` passed.
- OpenAPI SHA-256: `B0BE366F979950C7B675B4779F5948381C0646B3FF34DBBD09BB722F404B708D`.
