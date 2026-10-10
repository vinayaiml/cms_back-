# CMS-65 Verification

Ticket: Add robot/user-aware LMS access to manifest

## Summary

- Added `RobotCourseAccess` and `UserCourseAccess` schema/migration models.
- Robot sync intersects organization course access with enabled robot-specific course access.
- Admin manifest preview now uses the same robot-aware filtering as robot sync.
- Added user-context manifest preview for `GET /robots/:id/users/:userId/manifest-preview`.
- User-context preview intersects organization, selected robot, and selected user course access.
- `myCoursesVersion` is hash-derived from effective course payload so versioning changes when delivered content changes.

## Verification

- `npm run test:unit -- --runTestsByPath src/modules/robot-sync/robot-sync.service.spec.ts src/modules/robots/robots.service.spec.ts --runInBand`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- Touched files checked for CRLF markers.

## Notes

- `D:\CMS_V1` is not a Git repository in this workspace, so `git diff --check` is not available there.
- `npm run prisma:generate` should be run from Windows before DB update/deploy because Prisma CLI hangs in this WSL session for `D:\CMS_V1`.
- No credentials, tokens, license keys, or prohibited personal data were added to fixtures, responses, or evidence.
