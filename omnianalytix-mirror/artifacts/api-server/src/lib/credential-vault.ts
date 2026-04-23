import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Cache the derived key per raw-key string so scryptSync (intentionally slow) runs once
// per process lifetime rather than on every encrypt/decrypt call.
const _keyCache = new Map<string, Buffer>();

// Track whether we've already emitted the dev-fallback warning so we don't
// spam logs on every encrypt/decrypt call.
let _warnedLegacyDecryptFallback = false;

type KeyPurpose = "encrypt" | "decrypt";

function deriveKey(rawKey: string): Buffer {
  const cached = _keyCache.get(rawKey);
  if (cached) return cached;
  const derived = crypto.scryptSync(rawKey, "omnianalytix-vault-salt", 32);
  _keyCache.set(rawKey, derived);
  return derived;
}

function getEncryptionKey(purpose: KeyPurpose): Buffer {
  const dedicatedKey = process.env.DB_CREDENTIAL_ENCRYPTION_KEY;
  // SEC-06: Encryption ALWAYS requires the dedicated key, in every environment.
  // Falling back to SESSION_SECRET for new writes would corrupt every stored
  // credential when the session secret rotates and would silently re-key the
  // vault if the dedicated key is later set. Decrypt may fall back in
  // development/test ONLY so legacy ciphertext can still be read.
  if (purpose === "encrypt") {
    if (!dedicatedKey) {
      throw new Error(
        "[CredentialVault] DB_CREDENTIAL_ENCRYPTION_KEY is required for encryption. " +
        "Set a dedicated 32-byte random hex secret. SESSION_SECRET is no longer accepted " +
        "as a fallback for new credential writes (would corrupt the vault on rotation).",
      );
    }
    return deriveKey(dedicatedKey);
  }

  // purpose === "decrypt"
  if (dedicatedKey) {
    return deriveKey(dedicatedKey);
  }

  const env = (process.env.NODE_ENV ?? "").toLowerCase();
  const fallbackAllowed = env === "development" || env === "test";
  if (!fallbackAllowed) {
    throw new Error(
      "[CredentialVault] DB_CREDENTIAL_ENCRYPTION_KEY must be set outside development/test. " +
      `(NODE_ENV="${process.env.NODE_ENV ?? ""}"). ` +
      "Refusing to decrypt with the SESSION_SECRET fallback.",
    );
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error(
      "[CredentialVault] DB_CREDENTIAL_ENCRYPTION_KEY or SESSION_SECRET must be set to decrypt legacy data.",
    );
  }
  if (!_warnedLegacyDecryptFallback) {
    _warnedLegacyDecryptFallback = true;
    console.warn(
      "[CredentialVault] DB_CREDENTIAL_ENCRYPTION_KEY is not set — decrypting legacy ciphertext " +
      "with SESSION_SECRET. This is for local development ONLY and is read-only. " +
      "New writes will be refused until DB_CREDENTIAL_ENCRYPTION_KEY is set.",
    );
  }
  return deriveKey(sessionSecret);
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey("encrypt");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return [iv.toString("hex"), tag.toString("hex"), encrypted].join(":");
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey("decrypt");
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Malformed ciphertext");

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
