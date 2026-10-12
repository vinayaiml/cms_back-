const SENSITIVE_KEY_PATTERN =
  /(password|passcode|token|jwt|secret|authorization|cookie|hash|apiKey|licenseKey|privateKey|accessKey|refreshToken|providerUrl|baseUrl)/i;

const SECRET_VALUE_PATTERNS = [
  /\bWHRB\d{6}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /\b(?:sk|rk|pk|ds)-[A-Za-z0-9._-]{12,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

const PHONE_CANDIDATE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ISO_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}/;

// Phone numbers have 10-15 digits; dates such as 2026-10-12 must survive redaction.
function redactPhoneNumbers(value: string) {
  return value.replace(PHONE_CANDIDATE_PATTERN, (candidate) => {
    if (ISO_DATE_PREFIX_PATTERN.test(candidate)) return candidate;
    const digits = candidate.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 15 ? "[REDACTED]" : candidate;
  });
}

export function redactText(value: string) {
  return redactPhoneNumbers(
    SECRET_VALUE_PATTERNS.reduce(
      (current, pattern) => current.replace(pattern, "[REDACTED]"),
      value,
    ),
  );
}

export function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      output[key] = redactValue(item);
    }
    return output;
  }

  return redactText(String(value));
}
