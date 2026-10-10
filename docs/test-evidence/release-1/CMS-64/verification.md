# CMS-64 Verification

Ticket: Add content availability and broken-link validation

## Summary

- Added asset validation before organization course-access assignment is created.
- Rejects missing, malformed, unsupported, credentialed, localhost/private-network, invalid-size and invalid-checksum lesson asset values.
- Probes public asset availability with HEAD and falls back to ranged GET when HEAD is unsupported.
- Rejects empty assignment scopes before mutation.
- Keeps authorization guard ordering so non-super-admin requests are rejected before asset reads or mutation.
- Keeps duplicate assignment validation after asset validation succeeds.

## Verification

- `npm run test:unit -- --runTestsByPath src/modules/course-access/course-access.service.spec.ts --runInBand`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- Touched files checked for CRLF markers.

## Notes

- `D:\CMS_V1` is not a Git repository in this workspace, so `git diff --check` is not available there.
- No credentials, tokens, license keys, or prohibited personal data were added to fixtures, responses, or evidence.
