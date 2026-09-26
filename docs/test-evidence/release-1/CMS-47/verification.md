# CMS-47 Verification

Ticket: Assign active subscription and validity to organization.

## Scope

- Added organization subscription persistence and validity window.
- Added Super Admin-only organization subscription read/assignment API.
- Robot sync now returns effective paid capabilities from the current valid active organization subscription.
- Expired, inactive, missing or inactive-plan subscriptions return an empty paid capability set.
- Assignment bumps tenantVersion and writes a sanitized critical audit event.

## Security Notes

- Organization subscription mutation is Super Admin-only.
- Organization-scoped users and robot tokens are rejected before direct-ID mutation/read.
- Responses and audit metadata do not include license keys, JWTs, passwords, credential ciphertext/fingerprints or private secret values.

## Verification Commands

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/orgs/orgs.service.spec.ts src/modules/orgs/orgs.controller.spec.ts src/modules/robot-sync/robot-sync.service.spec.ts --runInBand
npm run build
npm run test:unit
npx @redocly/cli@latest lint docs/api/openapi.yaml
git diff --check
```

## Expected Results

- Active subscription returns the assigned plan capability set.
- Expired subscription returns `paidCapabilities: []`.
- Invalid validity window is rejected.
- Inactive plan assignment is rejected.
- Unauthorized direct-ID subscription read/update is rejected.
