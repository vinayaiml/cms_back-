# CMS-52 Verification - Effective Entitlement Resolver

## Scope

CMS-52 implements the shared effective-entitlement resolver for F04. The resolver consumes subscription, organization override, robot assignment, optional user assignment and hardware metadata inputs and returns only the final permitted capability set.

## Expected Behavior

- Active subscription plan capabilities form the base entitlement set.
- Expired, inactive, missing or future subscriptions do not grant paid capabilities.
- Organization `DENY` overrides remove capabilities and `ALLOW` overrides add active capabilities for the target organization only.
- Robot assignments intersect with the organization-effective set.
- Optional user assignments further intersect with the robot/organization-effective set when supplied.
- Capability `requiredHardware` is enforced against robot hardware capabilities.
- Returned capability rows include validated limits and safe catalogue metadata only.
- Responses do not include license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Verification Commands

```text
npx jest --config jest.unit.config.js --runTestsByPath src/modules/entitlements/entitlements.service.spec.ts src/modules/robot-sync/robot-sync.service.spec.ts src/modules/users/users.service.spec.ts src/modules/robots/robots.service.spec.ts src/modules/tenant-isolation/tenant-isolation.spec.ts --runInBand
npm run prisma:generate
npm run build
npm run test:unit
npx @redocly/cli@latest lint docs/api/openapi.yaml
git diff --check -- <CMS-52 files>
```

## Results

PASS.

- Targeted resolver suite passed: 5 suites, 62 tests.
- `npm run prisma:generate` passed.
- `npm run build` passed.
- `npm run test:unit` passed: 23 suites, 145 tests.
- `npx @redocly/cli@latest lint docs/api/openapi.yaml` passed with existing warnings only.
- Focused `git diff --check` for CMS-52 files passed.
- OpenAPI SHA-256: `640F80411088B5696EFF4B5328D07A84183D87B6BF9D7DA87C8B737090F732EF`.
