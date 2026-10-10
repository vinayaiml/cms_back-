import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "crypto";

const SECRET_ENV = "LICENSE_SECRET_KEY";

function readSecret() {
  const secret = process.env[SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(`${SECRET_ENV} is required`);
  }
  return secret;
}

function keyMaterial() {
  return createHash("sha256").update(readSecret()).digest();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function protectedJsonFingerprint(value: unknown) {
  return createHmac("sha256", keyMaterial())
    .update(stableStringify(value))
    .digest("hex");
}

export function encryptProtectedJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const plaintext = stableStringify(value);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptProtectedJson(ciphertext: string) {
  const [version, iv, tag, encrypted] = ciphertext.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Invalid protected JSON format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyMaterial(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext);
}
