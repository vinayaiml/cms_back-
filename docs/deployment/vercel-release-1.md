# Release 1 Vercel Deployment Guide

This guide is for the `task/fix` Release 1 testing branch. It keeps local development unchanged and adds Vercel support for integration testing.

## Deployment Shape

Use three separate services:

| Service | Platform | Notes |
| --- | --- | --- |
| Database | Neon | PostgreSQL, external to Vercel |
| Backend | Vercel project | NestJS served through a serverless function |
| Frontend | Vercel project | Next.js app |

Do not commit database URLs, passwords, JWT secrets, API tokens or private keys.

## Backend Project

Create one Vercel project for the backend.

Recommended settings:

```text
Framework Preset: Other
Root Directory: backend
Install Command: npm install
Build Command: npm run build
Output Directory: leave empty
```

The backend uses:

```text
backend/vercel.json
backend/api/index.ts
backend/src/app.setup.ts
```

Local startup still uses:

```text
backend/src/main.ts
```

## Backend Environment Variables

Set these in the Vercel backend project:

```env
DATABASE_URL=<neon-pooled-postgres-url>
JWT_SECRET=<strong-release-1-secret>
JWT_EXPIRES_IN=7d
REDIS_ENABLED=false
REDIS_URL=redis://localhost:6379
CORS_ALLOWED_ORIGINS=https://<frontend-project>.vercel.app
```

If you use Vercel preview deployments, add every approved preview frontend origin to `CORS_ALLOWED_ORIGINS` as a comma-separated list.

Example shape:

```env
CORS_ALLOWED_ORIGINS=https://cms-frontend-release1.vercel.app,https://cms-frontend-release1-git-task-fix-team.vercel.app
```

Do not use `*`. Production startup validation rejects wildcard CORS.

## Database Preparation

Run Prisma against Neon from your local machine after setting `backend/.env` to the Neon connection string:

```cmd
cd D:\CMS\backend
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
```

Seed passwords must be set in `backend/.env` before seeding:

```env
SUPER_ADMIN_PASSWORD=<secure-value>
DEMO_ADMIN_PASSWORD=<secure-value>
TEST_USER_PASSWORD=<secure-value>
```

Do not add these seed passwords to Vercel unless a controlled remote seed process is approved.

## Frontend Project

Create a second Vercel project for the frontend.

Recommended settings:

```text
Framework Preset: Next.js
Root Directory: frontend
Install Command: npm install
Build Command: npm run build
Output Directory: .next
```

## Frontend Environment Variables

Set this in the Vercel frontend project:

```env
NEXT_PUBLIC_API_BASE_URL=https://<backend-project>.vercel.app
```

After the frontend URL is created, update the backend project `CORS_ALLOWED_ORIGINS` to include that exact frontend URL.

## Verification

After deployment, verify:

```text
GET  https://<backend-project>.vercel.app/api/docs
POST https://<backend-project>.vercel.app/api/v1/auth/login
POST https://<backend-project>.vercel.app/api/v1/robot/auth/login
GET  https://<backend-project>.vercel.app/api/v1/robot/sync
POST https://<backend-project>.vercel.app/api/v1/robot/logs/batch
```

Use `Authorization: Bearer <robot-token>` for robot sync and log upload.

Then verify the frontend:

```text
https://<frontend-project>.vercel.app
```

Login should call the deployed backend, not `localhost`.

## Known Release 1 Constraints

- Docker Compose is local only. Vercel does not run the local PostgreSQL container.
- Redis-backed jobs should remain disabled with `REDIS_ENABLED=false` unless a serverless-safe jobs design is approved.
- First requests can be slower because Vercel serverless functions may cold start.
- Integration, staging and production must use separate databases and secrets.
- This branch is for Release 1 testing and should not be treated as production approval.
