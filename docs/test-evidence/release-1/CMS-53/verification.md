# CMS-53 Verification - Organization and Robot Capability Assignment UI

## Scope

- Added CMS UI for organization capability overrides and robot capability assignments.
- Added resolver-backed organization and robot effective capability preview endpoints.
- Added navigation entry for Capability Access when `subscription.manage` is available.

## Backend verification targets

- `GET /api/orgs/:id/effective-capabilities`
- `GET /api/robots/:id/effective-capabilities`
- Existing protected assignment APIs:
  - `GET /api/orgs/:id/capability-overrides`
  - `PUT /api/orgs/:id/capability-overrides`
  - `GET /api/robots/:id/capability-assignments`
  - `PUT /api/robots/:id/capability-assignments`

## Expected behavior

- Effective preview is returned from the shared entitlement resolver.
- Robot preview enforces tenant scope through the robot service before returning capability data.
- Organization preview is Super Admin scoped.
- UI does not display license keys, tokens, credentials, or prohibited PII.
- Invalid capability limit JSON is rejected client-side before submission.

## Verification commands

```bash
cd D:\CMS_V1\CMS_Back
npm run build
npm run test:unit

cd D:\CMS_V1\CMS_Front\frontend
npm run test
npm run typecheck
npm run build
```

## Local results

- Backend build passed.
- Backend unit tests passed: 23 suites, 148 tests.
- Frontend tests passed: 5 files, 13 tests.
- Frontend typecheck passed.
- Frontend production build passed.
- Frontend lint passed with existing warnings outside the CMS-53 page.
- OpenAPI YAML parse passed after adding the preview endpoint contract.
- Focused `git diff --check` passed for CMS-53 backend and frontend files.

# CMS-53 V1 Fix Note

- Capability Access remains Super Admin-only because it depends on Super Admin organization administration endpoints.
- Organization capability override responses include top-level `capabilityStableKey` and `capabilityName` to match OpenAPI.
- Org-user navigation excludes stale `capability-assignments` dashboard rows.
