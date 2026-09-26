# CMS-44 Verification Notes

Ticket: Add batch-safe license expiry job tests

Date: 2026-09-24

## Scope Verified

- License scan marks expired active robot licenses as `EXPIRED`.
- Re-running the scan is idempotent for an already-expired robot.
- Expired-license notification creation is deduped by stable organization, type and message.
- Duplicate notification writes from repeated or overlapping batch execution are treated as already handled.
- Revoked licenses are not converted to expired and do not create expiry notifications.
- Notification payloads do not include license keys, tokens, ciphertext, fingerprints or credential secrets.

## Evidence Commands

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/jobs/jobs.service.spec.ts --runInBand --verbose
npm run build
git diff --check
```

## Notes

CMS-44 does not add a new HTTP contract, so OpenAPI was not changed by this ticket. The job remains internal and is covered through backend unit tests.
