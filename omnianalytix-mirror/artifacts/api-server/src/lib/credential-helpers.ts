import { encrypt, decrypt } from "./credential-vault";
import { logger } from "./logger";

export function encryptCredentials(creds: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {};
  const sensitiveKeys = ["accessToken", "refreshToken", "developerToken", "serviceAccountKey"];
  for (const [key, value] of Object.entries(creds)) {
    if (sensitiveKeys.includes(key) && value) {
      try {
        encrypted[key] = encrypt(value);
      } catch (err) {
        logger.error({ key, err }, "[CredentialVault] Failed to encrypt credential field");
        throw new Error(`Credential encryption failed for field: ${key}`);
      }
    } else {
      encrypted[key] = value;
    }
  }
  return encrypted;
}

export function decryptCredentials(creds: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {};
  const sensitiveKeys = ["accessToken", "refreshToken", "developerToken", "serviceAccountKey"];
  for (const [key, value] of Object.entries(creds)) {
    if (sensitiveKeys.includes(key) && value) {
      try {
        decrypted[key] = decrypt(value);
      } catch (err) {
        const looksEncrypted = value.includes(":") && value.split(":").length === 3;
        if (looksEncrypted) {
          // The value is in our iv:tag:ciphertext format but failed to decrypt.
          // This means a wrong key, key rotation without re-encryption, or corrupt data.
          // Returning the raw ciphertext would silently pass garbage to every API call.
          logger.error(
            { key, err },
            "[CredentialVault] Decryption failed for ciphertext-format value — possible key mismatch or data corruption. Returning empty string; re-authenticate to fix.",
          );
          decrypted[key] = "";
        } else {
          // Value doesn't match our encrypted format — stored as legacy plaintext.
          logger.warn({ key }, "[CredentialVault] Credential field appears to be plaintext (pre-encryption). Re-authenticate to encrypt.");
          decrypted[key] = value;
        }
      }
    } else {
      decrypted[key] = value;
    }
  }
  return decrypted;
}
