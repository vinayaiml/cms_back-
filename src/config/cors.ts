export function parseAllowedOrigins(value: string | undefined) {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}
