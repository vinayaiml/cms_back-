# CMS-55 Verification - Versioned Bootstrap Manifest Contract

## Scope

CMS-55 defines the robot sync response as the single versioned bootstrap manifest contract for Android startup and offline-cache decisions.

## Expected behavior

- `GET /api/v1/robot/sync` returns `manifestVersion`, `tenant`, `license`, `capabilities`, `policies`, `contentVersions` and `sync` metadata for success and expired/revoked locked-license responses.
- `tenant` reuses the CMSF02-T03 organization context/branding shape with `tenantVersion` and `cacheVersion`.
- `capabilities.effective` is populated from the existing entitlement resolver output.
- Backward-compatible aliases remain available as `organization`, `entitlements`, `myCourses`, `publicCatalog` and `syncedAt` during the transition.
- The manifest response does not include license keys, JWTs, passwords, ciphertext, fingerprints or credential secrets.

## Verification commands

```text
cd CMS_Back
npm run build
npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts
```

## Local results

- `npm run build` passed.
- `npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts` passed: 2 suites, 23 tests.
- Focused coverage includes success manifest, expired/revoked locked manifests, inactive organization locked error, unauthorized non-robot token rejection and invalid heartbeat rejection.
