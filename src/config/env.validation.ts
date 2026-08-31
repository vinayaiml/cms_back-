type Env = Record<string, string | undefined>;

import { isLocalOrigin, parseAllowedOrigins } from './cors';

const unsafeValues = new Set([
  'change-me',
  'changeme',
  'secret',
  'jwt-secret',
  'password',
  'default',
  'test',
]);

function clean(value: string | undefined) {
  return value?.trim();
}

function requireValue(env: Env, key: string, errors: string[]) {
  const value = clean(env[key]);
  if (!value) {
    errors.push(`${key} is required`);
    return '';
  }
  return value;
}

function rejectUnsafeSecret(key: string, value: string, errors: string[]) {
  if (unsafeValues.has(value.toLowerCase())) {
    errors.push(`${key} must not use a default or placeholder value`);
  }
}

function requireUrl(key: string, value: string, errors: string[]) {
  try {
    new URL(value);
  } catch {
    errors.push(`${key} must be a valid URL`);
  }
}

function readBoolean(env: Env, key: string, defaultValue: boolean, errors: string[]) {
  const value = clean(env[key]);
  if (!value) return defaultValue;

  if (value === 'true') return true;
  if (value === 'false') return false;

  errors.push(`${key} must be true or false`);
  return defaultValue;
}

export function validateEnv(config: Env) {
  const errors: string[] = [];
  const nodeEnv = clean(config.NODE_ENV) || 'development';
  const isProduction = nodeEnv === 'production';

  const jwtSecret = requireValue(config, 'JWT_SECRET', errors);
  if (jwtSecret) rejectUnsafeSecret('JWT_SECRET', jwtSecret, errors);

  const databaseUrl = requireValue(config, 'DATABASE_URL', errors);
  if (databaseUrl) {
    requireUrl('DATABASE_URL', databaseUrl, errors);
    if (databaseUrl.includes('change-me')) {
      errors.push('DATABASE_URL must not use a default or placeholder value');
    }
  }

  const port = clean(config.PORT);
  if (port && (!Number.isInteger(Number(port)) || Number(port) <= 0)) {
    errors.push('PORT must be a positive integer');
  }

  const redisEnabled = readBoolean(config, 'REDIS_ENABLED', false, errors);
  const redisUrl = clean(config.REDIS_URL);

  if (redisEnabled) {
    if (!redisUrl) {
      errors.push('REDIS_URL is required when REDIS_ENABLED=true');
    } else {
      requireUrl('REDIS_URL', redisUrl, errors);
      if (redisUrl.includes('change-me')) {
        errors.push('REDIS_URL must not use a default or placeholder value');
      }
    }
  }

  const allowedOrigins = parseAllowedOrigins(config.CORS_ALLOWED_ORIGINS);
  if (allowedOrigins.includes('*')) {
    errors.push('CORS_ALLOWED_ORIGINS must not contain wildcard origin when credentials are enabled');
  }

  if (isProduction && !allowedOrigins.length) {
    errors.push('CORS_ALLOWED_ORIGINS is required in production');
  }

  for (const origin of allowedOrigins) {
    requireUrl('CORS_ALLOWED_ORIGINS', origin, errors);
    if (isProduction && isLocalOrigin(origin)) {
      errors.push('CORS_ALLOWED_ORIGINS must not include local development origins in production');
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return {
    ...config,
    JWT_SECRET: jwtSecret,
    DATABASE_URL: databaseUrl,
    REDIS_ENABLED: String(redisEnabled),
    CORS_ALLOWED_ORIGINS: allowedOrigins.join(','),
  };
}
