# F01 Pre-Release Cleanup and License Protection Notes

## Scope

- Added protected robot license storage using encrypted license ciphertext plus a keyed fingerprint for lookup.
- New robot enrollment and credential rotation no longer write raw license keys into normal storage.
- Robot login still accepts `licenseKey` plus `serialNumber` from Android.
- Super Admin robot management responses include `licenseKey` and `licenseKeyMasked`; the CMS frontend masks by default and reveals the raw value for five seconds through the eye button.
- Organization users do not receive robot license keys from robot list APIs.
- Added a guarded data-cleanup command that deletes database rows without dropping tables.

## Database Cleanup

Local or integration cleanup:

```text
cd backend
set CONFIRM_CLEAR_DATA=DELETE_ROWS
npm run db:clear
npm run prisma:seed
```

Remote integration cleanup additionally requires:

```text
set ALLOW_REMOTE_DATA_CLEAR=true
```

Do not run the cleanup command against production.

## Security Notes

- `LICENSE_SECRET_KEY` is required and must remain stable per environment.
- Raw license keys are not written to audit metadata.
- Robot login responses do not return license keys.
- Existing plaintext `Robot.licenseKey` remains only as a nullable legacy fallback during migration. Clean F01 databases seeded after this change store protected license material.

## Verification

- `npm run prisma:generate` passed.
- Backend `npm run build` passed.
- Backend service unit suites passed during `npm run test:unit`.
- Full backend unit command hit the sandbox Supertest listener issue: `listen EPERM 0.0.0.0`.
- Frontend `npm run typecheck` passed.
- Frontend build/test in WSL hit native optional dependency issues from Windows-installed `node_modules`.
