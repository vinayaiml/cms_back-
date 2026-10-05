# CMS-57 Verification - Manifest Configuration Version and ETag

## Scope

Add stable bootstrap manifest configuration version and ETag/hash support for robot sync.

## Expected behavior

- `GET /api/v1/robot/sync` returns a full manifest with `schemaVersion`, `manifestVersion`, tenant, license, effective capabilities, policies, content versions and sync metadata.
- Sync metadata includes `configVersion` and `manifestHash`.
- The HTTP response includes an `ETag` header containing the current manifest hash.
- A repeated request with matching `If-None-Match` returns `304 Not Modified` with no body.
- Hash generation uses stable manifest configuration data and does not change only because `serverTime` or `syncedAt` changed.
- Tenant isolation remains enforced by resolving the manifest only for the authenticated robot.
- No license key, JWT, password, token, credential ciphertext, credential fingerprint, or secret is returned in the manifest.

## Verification commands

```bash
cd backend
npm run build
npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts src/modules/tenant-isolation/tenant-isolation.spec.ts
npx @redocly/cli@latest lint ../docs/api/openapi.yaml
git diff --check origin/dev...HEAD
```

## Result

Local verification passed.

- `npm run build` passed.
- Focused robot sync and tenant-isolation unit tests passed: 3 suites, 32 tests.
- Full backend unit suite passed: 23 suites, 160 tests.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing repository warnings only.
- `git diff --check origin/dev...HEAD` passed.
