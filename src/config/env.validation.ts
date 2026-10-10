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

function readOptionalSafeAlias(env: Env, key: string, fallback: string, errors: string[]) {
  const value = clean(env[key]);
  if (!value) return fallback;
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) {
    errors.push(`${key} must be a safe alias using lowercase letters, numbers, dots, dashes or underscores`);
    return fallback;
  }
  return value;
}

function durationToSeconds(value: string) {
  const match = value.trim().match(/^(\d+)([smhd])?$/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * multipliers[unit];
}

function readDuration(env: Env, key: string, defaultValue: string, errors: string[]) {
  const value = clean(env[key]) || defaultValue;
  const seconds = durationToSeconds(value);

  if (!seconds || seconds <= 0) {
    errors.push(`${key} must be a positive duration such as 15m, 1h or 7d`);
  }

  return value;
}

export function validateEnv(config: Env) {
  const errors: string[] = [];
  const nodeEnv = clean(config.NODE_ENV) || 'development';
  const isProduction = nodeEnv === 'production';

  const jwtSecret = requireValue(config, 'JWT_SECRET', errors);
  if (jwtSecret) rejectUnsafeSecret('JWT_SECRET', jwtSecret, errors);

  const licenseSecretKey = requireValue(config, 'LICENSE_SECRET_KEY', errors);
  if (licenseSecretKey) {
    rejectUnsafeSecret('LICENSE_SECRET_KEY', licenseSecretKey, errors);
    if (licenseSecretKey.length < 32) {
      errors.push('LICENSE_SECRET_KEY must be at least 32 characters');
    }
  }

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

  const robotAccessTokenExpiresIn = readDuration(config, 'ROBOT_ACCESS_TOKEN_EXPIRES_IN', '15m', errors);
  const robotRefreshTokenExpiresIn = readDuration(config, 'ROBOT_REFRESH_TOKEN_EXPIRES_IN', '7d', errors);
  const robotAccessSeconds = durationToSeconds(robotAccessTokenExpiresIn);
  const robotRefreshSeconds = durationToSeconds(robotRefreshTokenExpiresIn);

  if (robotAccessSeconds && robotAccessSeconds > 60 * 60) {
    errors.push('ROBOT_ACCESS_TOKEN_EXPIRES_IN must not be longer than 1h');
  }

  if (robotAccessSeconds && robotRefreshSeconds && robotRefreshSeconds <= robotAccessSeconds) {
    errors.push('ROBOT_REFRESH_TOKEN_EXPIRES_IN must be longer than ROBOT_ACCESS_TOKEN_EXPIRES_IN');
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

  const aiGatewayProvider = clean(config.AI_GATEWAY_PROVIDER) || 'mock';
  const aiGatewayBaseUrl = clean(config.AI_GATEWAY_BASE_URL);
  if (aiGatewayBaseUrl) {
    requireUrl('AI_GATEWAY_BASE_URL', aiGatewayBaseUrl, errors);
  }
  const aiGatewayProviderAlias = readOptionalSafeAlias(
    config,
    'AI_GATEWAY_PROVIDER_ALIAS',
    'cms-ai-provider',
    errors,
  );
  const aiGatewayModelAlias = readOptionalSafeAlias(
    config,
    'AI_GATEWAY_MODEL_ALIAS',
    'default-conversation-model',
    errors,
  );
  const aiGatewayPolicyVersion = readOptionalSafeAlias(
    config,
    'AI_GATEWAY_POLICY_VERSION',
    'ai-provider-policy-v1',
    errors,
  );

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return {
    ...config,
    JWT_SECRET: jwtSecret,
    LICENSE_SECRET_KEY: licenseSecretKey,
    DATABASE_URL: databaseUrl,
    ROBOT_ACCESS_TOKEN_EXPIRES_IN: robotAccessTokenExpiresIn,
    ROBOT_REFRESH_TOKEN_EXPIRES_IN: robotRefreshTokenExpiresIn,
    REDIS_ENABLED: String(redisEnabled),
    CORS_ALLOWED_ORIGINS: allowedOrigins.join(','),
    AI_GATEWAY_PROVIDER: aiGatewayProvider,
    AI_GATEWAY_PROVIDER_ALIAS: aiGatewayProviderAlias,
    AI_GATEWAY_MODEL_ALIAS: aiGatewayModelAlias,
    AI_GATEWAY_POLICY_VERSION: aiGatewayPolicyVersion,
  };
}
