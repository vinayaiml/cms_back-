# CMS-41 Verification Notes

Ticket: Expand robot assignment history and fleet reassignment controls

Date: 2026-09-21

## Scope Verified

- Existing `PATCH /api/robots/:id/reassign` contract remains unchanged.
- Reassignment still increments old and new organization `tenantVersion` values so robot sync cache versions change.
- Same-organization reassignment is idempotent and does not write a new audit event or bump tenant versions.
- Reassignment history is read from sanitized `robot.reassigned` audit events.
- History response includes actor, old organization, new organization, correlation ID and timestamp.
- Cross-tenant direct robot ID access is rejected before audit history is queried.
- History responses do not return license keys, tokens, credential ciphertext, fingerprints or raw audit metadata.

## Evidence Commands

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/robots/robots.service.spec.ts --runInBand --verbose
npm run build
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('../docs/api/openapi.yaml','utf8')); console.log('openapi yaml ok')"
git diff --check
```

## Notes

- This ticket expands fleet administration history/reporting only.
- It does not introduce a second robot reassignment or Android sync contract shape.
