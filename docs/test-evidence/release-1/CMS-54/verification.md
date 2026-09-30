# CMS-54 Verification - Entitlement Audit and Expiry Tests

## Scope

CMS-54 adds repeatable backend verification that entitlement revocation and expiry/inactive subscription state take effect on the next robot manifest sync.

## Expected behavior

- Active subscription and robot assignment capabilities are returned in the manifest.
- A subsequent organization DENY override removes the revoked capability on the next `RobotSyncService.sync` call.
- Expired and inactive subscriptions return an empty paid capability set on sync.
- Entitlement and audit metadata do not include license keys, tokens, passwords or secrets.

## Verification commands

```text
cd CMS_Back
npm run build
npm run test:unit
git diff --check -- <CMS-54 files>
```

## Local results

- `npm run build` passed.
- `npm run test:unit` passed: 23 suites, 152 tests.
- Added robot manifest-sync tests for entitlement revocation and inactive subscription expiry behavior.
- Added audit metadata assertion confirming no license keys, tokens, passwords or secrets are included in capability override audit calls.
