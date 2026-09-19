# CMS-39 Verification

Ticket: Add unique registration/enrollment workflow for a new robot

## Scope

- Enforces unique robot serial enrollment through backend validation.
- Keeps the database unique constraint as the final race-condition safety net.
- Preserves the existing protected license generation and sanitized `robot.enrolled` audit event for successful enrollment.

## Expected Behavior

- `POST /api/robots` succeeds for a new serial number and creates a sanitized `robot.enrolled` audit event.
- `POST /api/robots` returns `409 Conflict` for a duplicate `serialNumber`.
- Duplicate serial rejection happens before license credential generation, robot creation and audit writes.
- Duplicate serial responses use the common error shape:

```json
{
  "statusCode": 409,
  "message": "Robot serial number already exists",
  "error": "Conflict"
}
```

## Verification Commands

```bash
cd backend
npm run prisma:generate
npm run test:unit -- --runTestsByPath src/modules/robots/robots.service.spec.ts --runInBand
npm run build
```

## Evidence Notes

- Unit coverage verifies duplicate serial rejection before credential generation or audit writes.
- Unit coverage verifies successful enrollment writes sanitized audit metadata.
- OpenAPI documents the duplicate serial `409 Conflict` response for robot enrollment.
- No license keys, JWTs, passwords or protected secrets are added to logs or audit metadata by this change.

## Local Verification

- `npm run prisma:generate` passed.
- `npm run test:unit -- --runTestsByPath src/modules/robots/robots.service.spec.ts --runInBand` passed: 15 tests.
- `npm run build` passed.
- OpenAPI YAML parse passed.
- `git diff --check` passed for CMS-39 touched files.
