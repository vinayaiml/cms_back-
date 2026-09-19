# CMS-40 Verification Notes

Ticket: Add license issue, renew, expire, revoke, restore tests and robot device-profile update contract

Date: 2026-09-19

## Scope Verified

- License renewal keeps valid licenses active and does not return raw credentials through normal robot responses.
- Past-dated renewal marks the license expired.
- Revoke and restore/unlock transitions keep license state consistent.
- Robot sync/device-profile access rejects expired, revoked and inactive-organization states with the shared locked error path.
- Robot-authenticated `PUT /api/v1/robot/device-profile` stores the latest approved Android app/device/hardware profile.
- Invalid hardware profile values are rejected before overwriting the last approved profile.
- Stale profile updates with an older `appVersionCode` are rejected before overwriting a newer approved profile.
- Repeating the same valid device/profile update is idempotent for stored approved values.
- CMS robot list/detail projection includes the latest approved `deviceMetadata`, `hardwareProfile` and `hardwareCapabilities` without adding license keys to organization-scoped list APIs.

## Sanitized Test Payload

```json
{
  "manufacturer": "Sanbot",
  "deviceModel": "Mini ELF",
  "androidVersion": "7.1.2",
  "apiLevel": 25,
  "appVersionName": "0.1.0",
  "appVersionCode": 2,
  "hardwareProfile": {
    "model": "MINI_ELF",
    "manufacturer": "Sanbot",
    "androidApiLevel": 25,
    "abi": "arm64-v8a",
    "display": {
      "width": 1920,
      "height": 1200
    },
    "capabilities": {
      "camera": true,
      "autonomousNavigation": true,
      "armMotion": true
    }
  }
}
```

## Evidence Commands

```text
npm run prisma:generate
npx jest --config jest.unit.config.js src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robot-sync/robot-sync.controller.spec.ts src/modules/robots/robots.service.spec.ts --runInBand
npm run build
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('../docs/api/openapi.yaml','utf8')); console.log('openapi yaml ok')"
git diff --check
```

## Security Notes

- Device/profile update responses do not include JWTs, refresh tokens, license keys, license ciphertext or license fingerprints.
- Audit/log metadata added by this ticket does not include secrets.
- Hardware capabilities remain metadata-only in F03; safety-controlled capabilities resolve to `false`.
