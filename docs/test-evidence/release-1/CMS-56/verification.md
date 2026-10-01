# CMS-56 Verification - Manifest Resolver Using Effective Entitlements

## Scope

CMS-56 extracts robot bootstrap manifest composition into a resolver that consumes the effective entitlement resolver as the source of truth for manifest capabilities.

## Expected behavior

- The test robot receives a complete versioned manifest with tenant, license, capabilities, policies, content versions, sync metadata, tenant content and public catalog data.
- `capabilities.effective` is populated only from the effective entitlement resolver result.
- Legacy `entitlements.paidCapabilities` and `capabilities.effective` stay aligned during the transition.
- Versioning and idempotency markers are stable for the same robot, tenant and content counts.
- Expired/revoked locked manifests, inactive organization locked errors, unauthorized tokens and invalid heartbeat headers remain covered.
- Manifest responses do not include license keys, JWTs, passwords, ciphertext, fingerprints or credential secrets.

## Verification commands

```text
cd backend
npm run build
npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts src/modules/tenant-isolation/tenant-isolation.spec.ts
```

## Local results

- `npm run build` passed.
- `npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts src/modules/tenant-isolation/tenant-isolation.spec.ts` passed: 3 suites, 30 tests.
