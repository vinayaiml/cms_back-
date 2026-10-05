# CMS-60 Verification - CMS Effective Robot Manifest Preview

## Scope

Added an authorized CMS preview surface for the effective robot bootstrap manifest.

## Implementation Summary

- Added `GET /api/robots/:id/manifest-preview` for CMS users with `robot.read`.
- Reuses the same `RobotSyncResponse` manifest contract used by robot sync.
- Supports optional `appVersionCode` query parameter to preview old-app update policy behavior.
- Enforces tenant scope before resolving the manifest.
- Adds a manifest preview panel to the CMS robot detail page.
- Preview output excludes license keys, JWTs, credential ciphertext, fingerprints, passwords and private secret fields.

## Verification Commands

- `npm run build`
- `npm run test:unit -- --runTestsByPath src/modules/robots/robots.controller.spec.ts src/modules/robots/robots.service.spec.ts`
- `npm run test:unit -- --runInBand`
- `npx @redocly/cli@latest lint docs/api/openapi.yaml`
- `git diff --check origin/dev...HEAD`

## Expected Result

- Authorized admin can preview the current effective robot manifest.
- Old app version code preview returns app-update policy with update required/recommended.
- Cross-tenant direct-ID preview attempts are rejected before entitlement resolution.
- No credential, token, license key or prohibited personal data appears in preview responses.
