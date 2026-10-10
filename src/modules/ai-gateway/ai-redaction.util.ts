export const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[REDACTED_EMAIL]',
  },
  // Phone numbers (international and national formats)
  {
    pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  // Bearer tokens & JWTs
  {
    pattern: /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g,
    replacement: '[REDACTED_JWT]',
  },
  // License keys (e.g. WHRB followed by alphanumeric)
  {
    pattern: /\bWHRB[A-Za-z0-9_-]{4,}\b/g,
    replacement: '[REDACTED_LICENSE_KEY]',
  },
  // API keys (sk-..., deepseek-..., etc.)
  {
    pattern: /\b(sk-[a-zA-Z0-9_-]{16,}|ak-[a-zA-Z0-9_-]{16,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  // Key-value credentials in text/JSON
  {
    pattern: /(password|secret|token|apiKey|licenseKey)["']?\s*[:=]\s*["']?([^"',\s}]+)/gi,
    replacement: '$1: "[REDACTED_SECRET]"',
  },
];

export function redactSensitiveData(text: string | null | undefined): string {
  if (!text) return '';
  let result = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactJsonPayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveData(value) as unknown as T;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonPayload(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|apiKey|licenseKey/i.test(k)) {
        clean[k] = '[REDACTED_SECRET]';
      } else {
        clean[k] = redactJsonPayload(v);
      }
    }
    return clean as unknown as T;
  }
  return value;
}
