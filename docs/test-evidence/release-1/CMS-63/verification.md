# CMS-63 Verification

Ticket: Add content version, size and checksum metadata

## Summary

- Added `contentVersion`, `contentSizeBytes` and `contentChecksum` fields to `Lesson`.
- Lesson update validates checksum and size metadata before mutation.
- `contentVersion` stays unchanged when file metadata is unchanged.
- `contentVersion` increments when content URL, checksum, type or size changes.
- Course detail responses include the approved lesson metadata fields.
- Content imports parse and persist optional file size and checksum metadata.

## Verification

- `npm run test:unit -- --runTestsByPath src/modules/content/content.service.spec.ts --runInBand`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- Touched files checked for CRLF markers.
- `npm run prisma:generate` was attempted from WSL, but the local V1 Prisma CLI hung before output. Run it from Windows before pushing/deploying.

## Acceptance Notes

- Modified file metadata increments lesson `contentVersion`.
- Unchanged file metadata keeps existing checksum and version.
- Invalid checksum and negative size metadata are rejected before persistence.
- No credentials, tokens, license keys, or prohibited personal data were added to fixtures, responses, or evidence.
