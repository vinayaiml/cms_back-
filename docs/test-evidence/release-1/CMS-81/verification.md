# CMS-81 Verification

## Scope

Add cross-tenant/deletion propagation contracts and complete the robot-facing AI
conversation and identity integration surfaces for Release 1 F08.

## Implementation Notes

- AI conversation responses now include `outOfContext` and `policyAction`.
- AI prompts are built from the robot's resolved conversation configuration,
  approved context and approved Q&A.
- Registered provider tools are sent as OpenAI-compatible tool definitions,
  filtered by effective capability and organization permission.
- Registered and unregistered tool rejections during conversation return safe
  HTTP 200 tool results with `status: rejected` and sanitized audit metadata.
- Added `POST /api/v1/robot/ai/conversation/stream` with SSE `ack`,
  `sentence`, `tool`, `done` and safe `error` events using provider
  `stream: true` requests.
- Added robot identity APIs for enrollment, gallery deltas, template backfill,
  recognition feedback and model metadata.
- Robot identity writes use `Idempotency-Key` replay storage and controller
  rate limiting.
- Robot gallery polling supports `ETag`/`If-None-Match` with HTTP 304.
- Bootstrap manifest carries identity gallery version/count only; records and
  tombstones are served from the gallery endpoint.
- Recognition model metadata is resolved per authenticated robot with signed
  download metadata and hardware/tier checks.
- Added `POST /api/internal/jobs/run`, protected by `JOBS_TRIGGER_SECRET`, for
  Vercel/manual execution of licence-expiry and identity-retention scans.
- Added recognition model/template/threshold/feedback schema and seeded identity
  recognition capabilities.
- Documented VPS/SSE production checklist in `README.md`.

## Verification Commands

Run before merge:

```text
cd backend
npm run prisma:generate
npx tsc --noEmit --pretty false --incremental false
npm run build
npm run test:unit -- --runInBand
npm run openapi:validate
git diff --check
```

## Evidence

- `docs/api/openapi.yaml` defines the robot identity endpoint paths:
  - `POST /v1/robot/identity/enrollments`
  - `GET /v1/robot/identity/gallery`
  - `POST /v1/robot/identity/{identityId}/templates`
  - `POST /v1/robot/identity/feedback`
  - `GET /v1/robot/identity/models/{modelId}`
  - `GET /v1/robot/identity/models/{modelId}/download`
- Defined OpenAPI request/response schemas and examples covering success, replay/idempotency, locked/inactive, unauthorized, rate limit, and invalid model/token.
- Added automated CI contract validation test suite in `backend/src/modules/identity/robot-identity-contract.spec.ts` (5/5 tests passed).
- Added `npm run openapi:validate` script to `backend/package.json` (`npx @redocly/cli@latest lint ../docs/api/openapi.yaml`) passing with zero errors.
- `npm run prisma:generate` passed in `backend`.
- `npx tsc --noEmit --pretty false --incremental false` passed in `backend` with zero errors.
- `npm run build` passed in `backend`.
- `npm run test:unit -- --runInBand` passed in `backend`: 32 suites, 286 tests passed.
- `git diff --check` passed cleanly across the repository.
- Sanitized implementation evidence only; no provider secret, token, license key or raw identity embedding appears in this file.
