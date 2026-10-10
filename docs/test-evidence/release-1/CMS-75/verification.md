# CMS-75 Verification - Conversation Publication Rollback Metadata

## Scope

- Added `ConversationPublicationRevision` schema and migration.
- Added publication metadata APIs:
  - `GET /api/orgs/:orgId/conversation-publications`
  - `PUT /api/orgs/:orgId/conversation-publications/:revisionId/restore`
- Organization persona, robot persona override, approved context and approved Q&A publication updates now create server-side revision records.
- Restore creates a new live version and bumps tenant version for manifest/cache refresh.

## Security Notes

- Revision list responses return sanitized metadata only and do not expose raw rollback snapshots.
- Audit metadata stores identifiers, versions and source type only.
- Provider secrets, tokens, license keys and prohibited personal data are not returned.

## Local Verification

- Suggested checks:
  - `cd D:\CMS_V1\CMS_Back && npm run prisma:generate`
  - `cd D:\CMS_V1\CMS_Back && npm run build`
