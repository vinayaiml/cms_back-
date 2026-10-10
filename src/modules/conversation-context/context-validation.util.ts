import { BadRequestException } from '@nestjs/common';

const PROHIBITED_SECRET_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]{15,}/i,
  /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}/,
  /\b(sk-[a-zA-Z0-9_-]{16,}|ak-[a-zA-Z0-9_-]{16,})\b/i,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i,
  /\b(password|secret|apikey|token|privatekey|licensekey)\s*[:=]\s*["']?[^"',\s}]{6,}["']?/i,
  /\bWHRB[A-Za-z0-9_-]{4,}\b/i, // WhizRobot license key
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN (prohibited personal data)
  /\b(?:\d{4}[-\s]?){3}\d{4}\b/, // Credit card (prohibited personal data)
];

export function validateNoProhibitedSecretsOrPii(
  value: string | null | undefined,
  fieldName = 'field',
): void {
  if (!value) return;

  for (const pattern of PROHIBITED_SECRET_PATTERNS) {
    if (pattern.test(value)) {
      throw new BadRequestException(
        `${fieldName} contains prohibited personal data or secret-like credentials`,
      );
    }
  }
}

export function validateObjectNoProhibitedData(
  obj: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      validateNoProhibitedSecretsOrPii(val, key);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          validateNoProhibitedSecretsOrPii(item, key);
        } else if (item && typeof item === 'object') {
          validateObjectNoProhibitedData(item as Record<string, unknown>);
        }
      }
    }
  }
}
