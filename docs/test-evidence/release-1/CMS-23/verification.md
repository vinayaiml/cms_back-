# CMS-23 Verification Notes

Ticket: Define robot enrollment and login contract including serial number and device metadata

## Scope Verified

- Protected robot enrollment is represented by `POST /api/robots`.
- Robot session login is represented by `POST /api/v1/robot/auth/login`.
- Login requires `licenseKey`, `serialNumber` and `deviceMetadata`.
- Android sends the Sanbot robot ID from device settings as `serialNumber`.
- Optional legacy `deviceMetadataConsent` is accepted only when `true`.
- Device metadata accepts only the contract fields in OpenAPI and rejects additional fields.
- Normal robot resource responses and login license responses exclude `licenseKey`.
- Rejected login events record controlled reason codes only, not credentials or raw request bodies.

## Contract Cases

| Case | Expected result |
| --- | --- |
| Success | `201 Created`, robot JWT returned, robot identity and license state returned without `licenseKey`. |
| Invalid license | `401 Unauthorized`, generic `Invalid robot credentials`. |
| Serial mismatch | `401 Unauthorized`, generic `Invalid robot credentials`, `ROBOT_LOGIN_REJECTED` event reason `SERIAL_MISMATCH`. |
| Expired license | `423 Locked`, error code `LICENSE_EXPIRED`, no token issued. |
| Revoked license | `423 Locked`, error code `LICENSE_REVOKED`, no token issued. |
| Inactive organization | `423 Locked`, error code `ORG_INACTIVE`, no token issued. |
| Invalid metadata | `400 Bad Request`, service is not called. |

## Repeatable Local Verification

```bash
cd CMS_Back
npm run test:unit -- --runTestsByPath src/modules/auth/robot-auth.controller.spec.ts src/modules/auth/auth.service.spec.ts src/modules/robots/robots.service.spec.ts
```

Expected result: all listed robot auth/enrollment contract tests pass.

## Secret Handling

- `licenseKey` is generated and stored server-side during robot enrollment but omitted from the selected `Robot` response.
- Robot login responses include a session token by design, but do not include the license key or raw submitted metadata.
- Stored device identity fields are SHA-256 digests for manufacturer, model and Android version.
- Audit metadata for `robot.enrolled` includes serial number, license status and license dates only.
- Rejected login events include `reason` and `endpoint` only.
