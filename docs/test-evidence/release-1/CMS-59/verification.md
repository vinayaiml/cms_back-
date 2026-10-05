# CMS-59 Verification - Minimum Supported App Version Policy

## Scope

Added minimum-supported and recommended app version policy fields to the robot bootstrap manifest and incremental sync contract.

## Implementation Summary

- Added `policies.appUpdate` to the versioned robot manifest.
- Added optional `X-Robot-App-Version-Code` heartbeat support for full sync and incremental changes.
- Uses heartbeat version code first, then stored approved device metadata version code when available.
- Includes app update policy in manifest hashing so policy changes are cache-visible.
- Incremental sync can return changed `policies` when the manifest hash changes without requiring a second contract shape.
- No license keys, JWTs, passwords, credential ciphertext or fingerprints are returned by the new policy fields.

## Verification Commands

- `npm run build`
- `npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.controller.spec.ts src/modules/robot-sync/robot-sync.service.spec.ts`
- `npm run test:unit`
- `npx @redocly/cli@latest lint docs/api/openapi.yaml`
- `git diff --check origin/dev...HEAD`

## Expected Result

- Current or missing app version code returns `updateRequired: false`.
- App version code below the minimum returns `updateRequired: true` and `updateRecommended: true`.
- Sync and sync changes responses remain tenant-scoped and do not expose credentials or license secrets.
