# WhizRobot CMS API Usage Guide

This document explains how to use the versioned CMS API routes added for CMS-17.
The official API contract remains `docs/api/openapi.yaml`.

## Base URLs

Local backend:

```text
http://localhost:3001/api
```

Version 1 baseline:

```text
http://localhost:3001/api/v1
```

Swagger UI:

```text
http://localhost:3001/api/docs
```

Raw OpenAPI YAML:

```text
http://localhost:3001/api/docs/openapi.yaml
```

## Versioning Rules

New Android, CMS frontend, and backend integrations should use `/api/v1`.

Approved legacy test routes still work temporarily, but they are deprecated:

| Legacy route | Version 1 route |
| --- | --- |
| `POST /api/auth/login` | `POST /api/v1/auth/login` |
| `POST /api/robot/auth/login` | `POST /api/v1/robot/auth/login` |
| `GET /api/robot/sync` | `GET /api/v1/robot/sync` |
| `POST /api/robot/logs/batch` | `POST /api/v1/robot/logs/batch` |

Legacy routes log a warning in the backend terminal:

```text
[legacy-api] <METHOD> <route> is deprecated; use /api/v1. Planned removal: v2.
```

Planned legacy removal: API v2.

## Authentication Headers

User APIs use a user JWT:

```text
Authorization: Bearer <user-token>
```

Robot APIs use a robot JWT:

```text
Authorization: Bearer <robot-token>
```

Do not use the user token for robot sync or robot log upload. Those routes require a robot token.

## User Login

Use this route for CMS users and administrators.

```text
POST http://localhost:3001/api/v1/auth/login
```

Body:

```json
{
  "email": "superadmin@whizrobo.com",
  "password": "<password>"
}
```

Success response:

```json
{
  "token": "<user-jwt>",
  "user": {
    "id": 1,
    "email": "superadmin@whizrobo.com",
    "fullName": "Super Admin",
    "orgId": null,
    "isSuperAdmin": true
  }
}
```

Expected status:

```text
201 Created
```

## Robot Login

Use this route to exchange a robot license key for a robot JWT.

```text
POST http://localhost:3001/api/v1/robot/auth/login
```

Body:

```json
{
  "licenseKey": "<license-key>"
}
```

Success response:

```json
{
  "token": "<robot-jwt>",
  "robot": {
    "id": 1,
    "orgId": 1,
    "serialNumber": "ROBOT-1-1",
    "name": "Robot 1 (ACTIVE)"
  },
  "license": {
    "licenseKey": "<license-key>",
    "validFrom": "2026-02-28T11:26:06.106Z",
    "validUntil": "2026-11-25T11:26:06.106Z",
    "status": "ACTIVE",
    "locked": false
  }
}
```

Expected status:

```text
201 Created
```

If the robot belongs to an inactive organization, the API returns:

```text
423 Locked
```

Example:

```json
{
  "error": {
    "code": "ORG_INACTIVE",
    "message": "Organization is inactive",
    "locked": true
  }
}
```

## Robot Sync

Use this route after robot login. It returns the robot configuration and available content.

```text
GET http://localhost:3001/api/v1/robot/sync
```

Headers:

```text
Authorization: Bearer <robot-token>
```

Success response:

```json
{
  "locked": false,
  "license": {
    "status": "ACTIVE",
    "validFrom": "2026-02-28T11:26:06.106Z",
    "validUntil": "2026-11-25T11:26:06.106Z"
  },
  "myCourses": [],
  "publicCatalog": [],
  "syncedAt": "2026-08-31T06:41:24.929Z"
}
```

Expected status:

```text
200 OK
```

## Robot Logs Batch

Use this route to upload usage logs from the robot.

```text
POST http://localhost:3001/api/v1/robot/logs/batch
```

Headers:

```text
Authorization: Bearer <robot-token>
Content-Type: application/json
```

Body:

```json
{
  "logs": [
    {
      "eventId": "thunder-test-001",
      "courseId": 1,
      "lessonId": 1,
      "openedAt": "2026-08-31T10:00:00.000Z",
      "durationSec": 60
    }
  ]
}
```

Minimal body:

```json
{
  "logs": [
    {
      "eventId": "thunder-test-001",
      "openedAt": "2026-08-31T10:00:00.000Z",
      "durationSec": 60
    }
  ]
}
```

Success response:

```json
{
  "inserted": 1
}
```

Expected status:

```text
201 Created
```

If the same `eventId` is sent again, the API may return:

```json
{
  "inserted": 0
}
```

That means the request was accepted, but the log already existed.

## Thunder Client Verification

1. Login as a CMS user:

```text
POST http://localhost:3001/api/v1/auth/login
```

2. Login as a robot:

```text
POST http://localhost:3001/api/v1/robot/auth/login
```

3. Copy the robot token from robot login.

4. Call robot sync:

```text
GET http://localhost:3001/api/v1/robot/sync
Authorization: Bearer <robot-token>
```

5. Upload robot logs:

```text
POST http://localhost:3001/api/v1/robot/logs/batch
Authorization: Bearer <robot-token>
Content-Type: application/json
```

6. Repeat the same requests against the legacy routes and confirm they still work.

7. Check the backend terminal for legacy deprecation warnings.

## Common Errors

Missing or invalid token:

```json
{
  "message": "No auth token",
  "error": "Unauthorized",
  "statusCode": 401
}
```

Wrong request body:

```json
{
  "message": [
    "logs must be an array"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

Inactive organization:

```json
{
  "error": {
    "code": "ORG_INACTIVE",
    "message": "Organization is inactive",
    "locked": true
  }
}
```

## Notes for New Development

- Use `/api/v1` for new work.
- Keep request and response changes in sync with `docs/api/openapi.yaml`.
- Do not add new unversioned routes for Android or CMS integrations.
- Do not rely on legacy routes except for approved temporary test integrations.
- Treat JWTs and license keys as secrets.
