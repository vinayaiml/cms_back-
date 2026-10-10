# CMS-72 Verification

## Scope

Implemented language, speech speed, session limits, and cooldown policies in CMS_V1 (part of F07 - Robot Persona, Greeting and Conversation Configuration):
- Extended `OrganizationPersonaConfig` and `RobotPersonaConfig` Prisma models and SQL migration:
  - `speechSpeed` (Float, range `0.5` - `2.0`, default `1.0`)
  - `sessionMaxSeconds` (Int, range `30` - `3600`, default `300`)
  - `sessionIdleTimeoutSeconds` (Int, range `10` - `600`, default `60`)
  - `cooldownSeconds` (Int, range `0` - `300`, default `5`)
  - `dailySessionLimit` (Int, range `1` - `100000`, default `1000`)
  - `supportedLanguages` (String/array, BCP 47 codes, default `["en-US"]`)
- Applied server-side validation against safe ranges and safe language formats (`400 Bad Request`).
- Enforced zero secret leakage: credentials, bearer tokens, API keys, private keys, passwords, and prohibited personal data (SSN, credit card numbers) are rejected before persistence.
- Maintained hierarchical resolution for effective policy settings:
  `robot override > organization default > system default`.
- Published conversation policy is versioned and included in the robot manifest under `conversation.policy`.
- Updating policies increments `tenantVersion` on `Organization` to invalidate client caches and bump manifest hash.
- Audit metadata records changed fields, versions, and publish state without leaking prompt text or secrets.
- Updated OpenAPI specification (`docs/api/openapi.yaml`) and API documentation (`docs/api/api.md`).

## Verification Commands

- `npm run prisma:generate`
- `npm run test:unit -- src/modules/persona/`
- `npm run test:unit -- src/modules/robot-sync/`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- `npm run test:unit -- --runInBand`
- `git diff --check`

## Result

Passed in CMS_V1 local and Vercel-ready verification:
- Focused CMS-72 persona tests passed: 1 suite, 18 tests.
- Focused CMS-72 robot sync tests passed: 2 suites, 36 tests.
- TypeScript check passed (`tsc --noEmit`).
- NestJS backend build passed (`nest build`).
- Full backend unit suite passed: 30 suites, 268 tests.
- Git diff check passed cleanly.
