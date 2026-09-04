# CMS-24 Verification Notes

Ticket: Bind robot login to license key plus registered serial/device identity

## Contract

Official endpoint:

```text
POST /api/v1/robot/auth/login
```

Required request fields:

- `licenseKey`
- `serialNumber`
- `deviceMetadata.manufacturer`
- `deviceMetadata.model`
- `deviceMetadata.androidVersion`
- `deviceMetadata.apiLevel`
- `deviceMetadata.appVersionName`
- `deviceMetadata.appVersionCode`
- optional legacy `deviceMetadataConsent`, accepted only when `true`

## Expected Results

- Valid license, matching serial and valid device metadata returns `201 Created`.
- Stolen license key with wrong serial returns `401 Unauthorized`.
- Expired license returns `423 Locked` with `LICENSE_EXPIRED`.
- Revoked license returns `423 Locked` with `LICENSE_REVOKED`.
- Inactive organization returns `423 Locked` with `ORG_INACTIVE`.
- Rejected login paths do not issue a JWT.
- Robot login and normal robot response schemas do not return `licenseKey`.
- False device metadata consent returns `400 Bad Request`; Android clients may omit the legacy consent field.
- Authorized administrators can erase stored device metadata with `DELETE /api/robots/{id}/device-metadata`.

## Data Controls

- Device metadata is limited to the technical fields listed in the OpenAPI contract.
- Extra metadata fields are rejected by the backend validation pipe.
- Device metadata consent is implied by the robot login contract for Android clients; an explicit legacy consent field is accepted only when true.
- CMS stores device identity fields as one-way SHA-256 digests in the robot `deviceMetadata` JSON column.
- Raw manufacturer, model and Android version values are not stored in `deviceMetadata`.
- Device metadata erasure clears the stored metadata fields and writes a critical audit event.
- License keys, JWTs and tokens are not written to security event payloads.
- Rejected serial mismatch is recorded as `ROBOT_LOGIN_REJECTED` with reason `SERIAL_MISMATCH`.
- Robot records remain organization-scoped through existing robot admin authorization checks.

## Verification Commands

```text
cd backend
npm run test:unit -- --runInBand
npm run build
npx @redocly/cli@latest lint ../docs/api/openapi.yaml
```

Integration database verification should be run with the project test database:

```text
set TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/whizrobot_test?schema=public
npm run test:integration
```
