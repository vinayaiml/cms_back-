const { spawnSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const envFile = join(process.cwd(), '.env.test');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error('Missing TEST_DATABASE_URL. Integration tests require an isolated test database.');
  process.exit(1);
}

if (/prod|production/i.test(testDatabaseUrl)) {
  console.error('Refusing to run integration tests against a production-looking database URL.');
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret',
  REDIS_ENABLED: process.env.REDIS_ENABLED || 'false',
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000',
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run('npx', ['prisma', 'db', 'push', '--skip-generate']);
run('npx', ['jest', '--config', 'jest.integration.config.js', '--runInBand']);
