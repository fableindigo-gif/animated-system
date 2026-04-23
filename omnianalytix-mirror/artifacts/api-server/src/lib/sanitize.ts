// ─── LLM Context Sanitizer ────────────────────────────────────────────────────
// Strips API tokens and OAuth credentials from any object before it is
// serialized into a Vertex AI functionResponse payload or stored as chat history.
//
// Defense layers:
//   1. Key-name blocklist — redacts values for known sensitive field names
//   2. Value-pattern blocklist — redacts strings matching known token formats
//      (shpat_, ya29., EAA..., long opaque hex/base64 strings)

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "developertoken",
  "developerkey",
  "apikey",
  "api_key",
  "token",
  "secret",
  "password",
  "passwd",
  "private_key",
  "privatekey",
  "client_secret",
  "clientsecret",
  "authorization",
  "bearer",
  "shpat",
  "shpss",
  "credential",
  "credentials",
]);

// Patterns that identify token-like string values regardless of key name.
const TOKEN_PATTERNS: RegExp[] = [
  /^shpat_/i,          // Shopify admin PAT
  /^shpss_/i,          // Shopify session token
  /^ya29\./i,          // Google OAuth2 access token
  /^EAA[A-Za-z0-9]/,  // Meta Graph API access token
  /^sk-[A-Za-z0-9]/,  // OpenAI-style secret key
  /^ghs_[A-Za-z0-9]/, // GitHub PAT
];

// Redact long opaque strings that look like random tokens (≥40 chars, high entropy).
function looksLikeToken(value: string): boolean {
  if (value.length < 40) return false;
  // Must be mostly alphanumeric / base64 chars with very few spaces
  const nonTokenChars = value.replace(/[A-Za-z0-9+/=_\-.]/g, "").length;
  const tokenRatio = 1 - nonTokenChars / value.length;
  return tokenRatio > 0.92;
}

function isTokenValue(value: string): boolean {
  if (TOKEN_PATTERNS.some((p) => p.test(value))) return true;
  if (looksLikeToken(value)) return true;
  return false;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Recursively walks `obj` and returns a sanitized deep-clone where:
 * - Values under sensitive keys are replaced with "[REDACTED]"
 * - String values matching token patterns are replaced with "[REDACTED]"
 * - Arrays are walked recursively
 * - Primitives are passed through as-is
 */
export function sanitizeForLLMContext(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return isTokenValue(obj) ? "[REDACTED]" : obj;
  }

  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeForLLMContext);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeForLLMContext(value);
    }
  }
  return result;
}
