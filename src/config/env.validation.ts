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

const safeAliasPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

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

function readOptionalSafeAlias(
  config: Env,
  key: string,
  errors: string[],
  defaultValue: string,
) {
  const value = clean(config[key]);
  if (!value) return defaultValue;
  if (!safeAliasPattern.test(value)) {
    errors.push(
      `${key} must start with a lowercase letter and use lowercase letters, numbers, dots, underscores or hyphens`,
    );
    return defaultValue;
  }
  return value;
}

function readBoolean(env: Env, key: string, defaultValue: boolean, errors: string[]) {
  const value = clean(env[key]);
  if (!value) return defaultValue;

  if (value === 'true') return true;
  if (value === 'false') return false;

  errors.push(`${key} must be true or false`);
  return defaultValue;
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

function readOptionalPositiveInteger(
  env: Env,
  key: string,
  errors: string[],
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
) {
  const value = clean(env[key]);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${key} must be an integer between ${min} and ${max}`);
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

  const aiProviderBaseUrl = clean(config.AI_PROVIDER_BASE_URL);
  const aiProviderApiKey = clean(config.AI_PROVIDER_API_KEY);
  const aiProviderModel = clean(config.AI_PROVIDER_MODEL);
  const aiConfigured = Boolean(aiProviderBaseUrl || aiProviderApiKey || aiProviderModel);
  if (aiConfigured) {
    if (!aiProviderBaseUrl) errors.push('AI_PROVIDER_BASE_URL is required when AI provider is configured');
    else requireUrl('AI_PROVIDER_BASE_URL', aiProviderBaseUrl, errors);
    if (!aiProviderApiKey) errors.push('AI_PROVIDER_API_KEY is required when AI provider is configured');
    else rejectUnsafeSecret('AI_PROVIDER_API_KEY', aiProviderApiKey, errors);
    if (!aiProviderModel) errors.push('AI_PROVIDER_MODEL is required when AI provider is configured');
  }
  readOptionalPositiveInteger(config, 'AI_PROVIDER_TIMEOUT_MS', errors, 1000, 30000);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_FIRST_TOKEN_TIMEOUT_MS', errors, 1000, 30000);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_MAX_RETRIES', errors, 0, 3);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_MAX_INPUT_CHARS', errors, 1, 12000);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_MAX_OUTPUT_TOKENS', errors, 1, 2048);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_MAX_ESTIMATED_COST_MICRO_USD', errors, 0, 1000000);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_INPUT_COST_MICRO_USD_PER_1K_TOKENS', errors, 0, 1000000);
  readOptionalPositiveInteger(config, 'AI_PROVIDER_OUTPUT_COST_MICRO_USD_PER_1K_TOKENS', errors, 0, 1000000);
  readOptionalPositiveInteger(config, 'IDENTITY_RETENTION_DAYS', errors, 1, 3650);
  const aiProviderAlias = readOptionalSafeAlias(
    config,
    'AI_PROVIDER_ALIAS',
    errors,
    'cms-ai-provider',
  );
  const aiProviderModelAlias = readOptionalSafeAlias(
    config,
    'AI_PROVIDER_MODEL_ALIAS',
    errors,
    'default-conversation-model',
  );
  const aiProviderPolicyVersion = readOptionalSafeAlias(
    config,
    'AI_PROVIDER_POLICY_VERSION',
    errors,
    'ai-provider-policy-v1',
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
    AI_PROVIDER_BASE_URL: aiProviderBaseUrl,
    AI_PROVIDER_API_KEY: aiProviderApiKey,
    AI_PROVIDER_MODEL: aiProviderModel,
    AI_PROVIDER_ALIAS: aiProviderAlias,
    AI_PROVIDER_MODEL_ALIAS: aiProviderModelAlias,
    AI_PROVIDER_POLICY_VERSION: aiProviderPolicyVersion,
  };
}
