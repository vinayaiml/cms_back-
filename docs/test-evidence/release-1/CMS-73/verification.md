# CMS-73 Verification - Conversation Feature Configuration UI

## Scope

- Added `/conversation-config` dashboard UI for organization persona defaults, robot overrides, approved organization context, approved Q&A and effective robot preview.
- Reused the existing V1 backend persona/context APIs:
  - `GET/PUT /api/orgs/:orgId/persona`
  - `GET/PUT /api/orgs/:orgId/robots/:robotId/persona`
  - `GET /api/orgs/:orgId/robots/:robotId/persona/effective`
  - `GET/PUT /api/orgs/:orgId/conversation-context`
  - `GET/PUT /api/orgs/:orgId/approved-qa`
- Added dashboard navigation fallback and seed metadata for the Conversation page.

## Security Notes

- Provider API keys, provider URLs and model secrets are not collected or displayed in the CMS-73 UI.
- UI payload helper emits only approved persona/policy fields and uses `isPublished` for V1 DTO compatibility.
- Backend tenant authorization remains enforced by existing org/robot persona and context services.

## Local Verification

- Not run in this workspace update.
- Suggested checks before merge:
  - `cd D:\CMS_V1\CMS_Back && npm run prisma:generate`
  - `cd D:\CMS_V1\CMS_Back && npm run build`
  - `cd D:\CMS_V1\CMS_Front\frontend && npm run typecheck`
  - `cd D:\CMS_V1\CMS_Front\frontend && npm run build`
