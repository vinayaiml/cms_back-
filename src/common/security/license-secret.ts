import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

const SECRET_ENV = 'LICENSE_SECRET_KEY';

function readSecret() {
  const secret = process.env[SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(`${SECRET_ENV} is required`);
  }
  return secret;
}

function keyMaterial() {
  return createHash('sha256').update(readSecret()).digest();
}

export function licenseFingerprint(licenseKey: string) {
  return createHmac('sha256', keyMaterial()).update(licenseKey.trim()).digest('hex');
}

export function encryptLicenseKey(licenseKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(licenseKey.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptLicenseKey(ciphertext: string) {
  const [version, iv, tag, encrypted] = ciphertext.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new Error('Invalid protected license key format');
  }

  const decipher = createDecipheriv('aes-256-gcm', keyMaterial(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function verifyLicenseKey(licenseKey: string, fingerprint: string | null | undefined) {
  if (!fingerprint) return false;

  const actual = Buffer.from(licenseFingerprint(licenseKey), 'hex');
  const expected = Buffer.from(fingerprint, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function maskLicenseKey(licenseKey: string | null | undefined) {
  if (!licenseKey) return null;
  if (licenseKey.length <= 6) return '*'.repeat(licenseKey.length);
  return `${licenseKey.slice(0, 6)}...${licenseKey.slice(-4)}`;
}
