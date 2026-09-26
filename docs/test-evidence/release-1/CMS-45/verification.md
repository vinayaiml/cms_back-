# CMS-45 Verification Notes

Ticket: Create capability catalogue schema with stable key, version and hardware requirements

Date: 2026-09-24

## Scope Verified

- Capability catalogue has a unique immutable `stableKey` and positive `version`.
- Capability create rejects duplicate stable keys with a safe conflict error.
- Stable key format rejects unsafe values before persistence.
- Hardware requirements validate against approved F03 robot hardware models, capabilities and ABI values.
- Organization users can read active catalog entries when authorized, but cannot mutate catalog rows.
- Super Admin can create, update and soft-disable catalog rows.
- Catalog responses contain metadata only and do not include credentials, license keys, JWTs, ciphertext, fingerprints or prohibited PII.

## Evidence Commands

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/capabilities/capabilities.service.spec.ts src/modules/capabilities/capabilities.controller.spec.ts --runInBand --verbose
npm run build
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('docs/api/openapi.yaml','utf8')); console.log('openapi yaml ok')"
git diff --check
```

## Notes

CMS-45 creates the catalogue metadata contract. Final subscription and entitlement resolution is intentionally left for later F04 tickets.
