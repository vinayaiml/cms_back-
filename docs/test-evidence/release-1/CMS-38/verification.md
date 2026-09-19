# CMS-38 Verification

Ticket: Add robot model and hardware-capability metadata schema

## Scope

- Stores validated robot hardware metadata during administrative robot enrollment.
- Returns only the effective permitted hardware capability set.
- Keeps F03 scoped to hardware/profile metadata only; final entitlement and safety-policy resolution remain later-phase work.

## Expected Behavior

- `POST /api/robots` accepts optional `hardwareProfile`.
- Supported hardware models are `MINI_ELF`, `ELF`, `NANO` and `S5`.
- Submitted hardware values must match the approved model policy.
- Unknown hardware models, mismatched Android API levels, mismatched ABI values, mismatched display profiles and invalid capability values return `400 Bad Request`.
- Safety-controlled capabilities currently resolve to disabled:
  - `autonomousNavigation: false`
  - `armMotion: false`
- Robot list and enrollment responses may return `hardwareModel`, `hardwareProfile` and `hardwareCapabilities`.
- License keys, JWTs, passwords and protected secrets are not written to audit metadata or logs by this change.

## Verification Commands

```bash
cd backend
npm run prisma:generate
npm run test:unit -- --runTestsByPath src/modules/robots/robots.service.spec.ts
npm run build
```

## Evidence Notes

- Unit coverage verifies valid hardware profile persistence and effective safety-filtered capabilities.
- Unit coverage verifies invalid hardware profile values are rejected before persistence.
- OpenAPI documents request/response hardware profile schemas and enrollment examples.
- Seed data includes stable robot hardware profiles for the Release 1 robot test credentials.

## Local Verification

- `npm run prisma:generate` passed.
- `npm run test:unit -- --runTestsByPath src/modules/robots/robots.service.spec.ts --runInBand` passed: 14 tests.
- `npm run build` passed.
- OpenAPI YAML parse passed.
- `git diff --check` passed for CMS-38 touched files after line-ending normalization.
