# Backend Test Harness

The backend test harness runs from this `CMS_Back` folder.

Run the complete CI-compatible backend suite:

```bash
npm run test:ci
```

This runs both suites:

```bash
npm run test:unit
npm run test:integration
```

Unit tests do not need a database:

```bash
npm run test:unit
```

Integration tests require a separate test database. Do not point `TEST_DATABASE_URL` at development, staging or production.

Create the local test database in the Docker PostgreSQL container:

```bash
docker exec -it whizrobot_postgres createdb -U postgres whizrobot_test
```

Set the test database URL by copying the example file:

```bash
cp .env.test.example .env.test
```

For PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/whizrobot_test?schema=public"
npm run test:integration
```

For bash:

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/whizrobot_test?schema=public" npm run test:integration
```

`npm run test:integration` pushes the Prisma schema to the isolated test database before running the database tests. If `TEST_DATABASE_URL` is missing, or looks like a production database URL, the command fails before running tests.

## CI

The GitHub Actions workflow at `.github/workflows/backend-tests.yml` runs `npm ci`, `npm run build`, and `npm run test:ci` with an isolated Postgres service, so CI fails when any backend test fails.

