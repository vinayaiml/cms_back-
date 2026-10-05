# CMS-58 Verification - Incremental Manifest Changes

## Scope

Add robot-authenticated incremental manifest changes support on top of the CMS-55/56/57 bootstrap manifest contract.

## Expected behavior

- `GET /api/v1/robot/sync/changes` is protected by robot JWT and `RobotOnlyGuard`.
- Matching `If-None-Match` returns `304 Not Modified` with no body.
- Missing or unsupported client baseline versions return `requiresFullSync: true`.
- Supported baseline versions return only stale sections under `changed`.
- The response includes current manifest hash/config version and content version markers.
- Tenant isolation is preserved because the endpoint resolves only the authenticated robot manifest.
- No license key, JWT, password, token, credential ciphertext, credential fingerprint, or secret is returned.

## Verification commands

```bash
cd backend
npm run build
npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts src/modules/tenant-isolation/tenant-isolation.spec.ts
npm run test:unit
npx @redocly/cli@latest lint ../docs/api/openapi.yaml
git diff --check origin/dev...HEAD
```

## Result

Local verification passed.

- `npm run build` passed.
- Focused robot sync and tenant-isolation unit tests passed: 3 suites, 36 tests.
- Full backend unit suite passed: 23 suites, 164 tests.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing repository warnings only.
- `git diff --check origin/dev...HEAD` passed.
