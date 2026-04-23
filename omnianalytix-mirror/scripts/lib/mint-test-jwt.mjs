/**
 * scripts/lib/mint-test-jwt.mjs
 *
 * Mint a synthetic gate JWT compatible with the API server's
 * `verifyGateJwt` (artifacts/api-server/src/routes/auth/gate.ts). Used by the
 * preflight smoke and tenant-fuzz scripts.
 *
 * The JWT is signed with the SAME `SESSION_SECRET` the running server uses,
 * so the server recognises us as a legitimate authenticated team-member.
 * The `memberId` is a synthetic high integer chosen NOT to collide with any
 * real team_members row; the surrounding RBAC code does not cross-check
 * membership against the DB, only the JWT contents.
 *
 * IMPORTANT: this script depends on `SESSION_SECRET` being present in the
 * environment. We never log or print the secret value; we just hand it to
 * `jsonwebtoken.sign`.
 */
import { createHmac } from "node:crypto";

// Minimal HS256 JWT signer — avoids pulling jsonwebtoken into the workspace
// root (it lives in the api-server's hoisted pnpm store, not directly
// resolvable from /scripts). Output is byte-identical to
// `jsonwebtoken.sign(payload, secret, { algorithm: "HS256" })`.
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function hs256(secret, payload, expiresInSec) {
  const header = { alg: "HS256", typ: "JWT" };
  const now    = Math.floor(Date.now() / 1000);
  const body   = { ...payload, iat: now, exp: now + expiresInSec };
  const head   = b64url(JSON.stringify(header));
  const data   = b64url(JSON.stringify(body));
  const sig    = b64url(createHmac("sha256", secret).update(`${head}.${data}`).digest());
  return `${head}.${data}.${sig}`;
}

export const TEST_ROLE_DEFAULT = "admin";
export const TEST_ORG_A        = 999_990_001;
export const TEST_ORG_B        = 999_990_002;
export const TEST_MEMBER_BASE  = 999_990_000;

export function mintTestJwt(opts = {}) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set in this shell. Source the workspace env or run inside a Replit shell that exposes it.",
    );
  }
  const organizationId = opts.organizationId ?? TEST_ORG_A;
  const role           = opts.role ?? TEST_ROLE_DEFAULT;
  const memberId       = opts.memberId ?? TEST_MEMBER_BASE + organizationId;
  const name           = opts.name ?? `preflight-bot-org-${organizationId}`;
  const email          = opts.email ?? `preflight+org${organizationId}@omnianalytix.test`;

  return hs256(
    secret,
    {
      type: "gate",
      authMethod: "password",
      memberId,
      organizationId,
      role,
      name,
      email,
    },
    600, // 10 minutes
  );
}

export function authHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: "application/json" };
}

export function apiBase() {
  // Default to the dev API server's bound port; override with
  // PREFLIGHT_API_BASE for staging/prod runs.
  const explicit = process.env.PREFLIGHT_API_BASE;
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = process.env.API_SERVER_PORT || process.env.PORT || "8080";
  return `http://localhost:${port}`;
}
