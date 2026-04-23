import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db, teamMembers, organizations } from "@workspace/db";
import { logger } from "../../lib/logger";

const router = Router();

const SITE_PASSWORD = process.env.SITE_PASSWORD ?? "";
// Module-load assertion: refuse to boot if SESSION_SECRET is missing. The
// `string` annotation propagates the narrowing into nested function scopes
// (TS doesn't follow control-flow narrowing across function boundaries).
const _SESSION_SECRET = process.env.SESSION_SECRET;
if (!_SESSION_SECRET) {
  throw new Error("FATAL: SESSION_SECRET environment variable is not set. Refusing to start.");
}
const JWT_SECRET: string = _SESSION_SECRET;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";

const JWT_EXPIRY = "30d";

export interface GateJwtPayload {
  type: "gate";
  authMethod?: "password" | "google_sso";
  googleSub?: string;
  memberId?: number;
  organizationId?: number;
  role?: string;
  name?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export function signGateJwt(payload: Omit<GateJwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyGateJwt(token: string): GateJwtPayload | null {
  try {
    // jsonwebtoken's overload returns `Jwt | JwtPayload | string` — funnel
    // through `unknown` so the cast to our shape is structurally honest.
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as GateJwtPayload;
    if (decoded.type !== "gate") return null;
    return decoded;
  } catch {
    return null;
  }
}

function legacyVerifyToken(token: string): boolean {
  const secret = JWT_SECRET;
  const colonIdx = token.indexOf(":");
  if (colonIdx === -1) return false;
  const hmacPart = token.slice(0, colonIdx);
  const expiryPart = token.slice(colonIdx + 1);
  const expiry = parseInt(expiryPart, 10);
  if (isNaN(expiry) || expiry < Date.now()) return false;
  const payload = `omnianalytix-gate:${expiry}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmacPart), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyAnyToken(token: string): GateJwtPayload | null {
  const jwtResult = verifyGateJwt(token);
  if (jwtResult) return jwtResult;
  if (legacyVerifyToken(token)) {
    return { type: "gate", authMethod: "password" };
  }
  return null;
}

function appDomain(req: { hostname: string }): string {
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const custom = replitDomains.find((d) => !d.endsWith(".replit.app") && !d.endsWith(".repl.co"));
  return custom ?? replitDomains[0] ?? req.hostname;
}

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "aol.com", "icloud.com",
  "me.com", "mac.com", "protonmail.com", "proton.me", "zoho.com",
  "yandex.com", "mail.com", "gmx.com", "gmx.net", "fastmail.com",
  "tutanota.com", "hey.com", "pm.me",
]);

function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

async function findExistingMember(
  email: string,
): Promise<{ memberId: number; organizationId: number; role: string; name: string } | null> {
  const member = (
    await db.select().from(teamMembers).where(eq(teamMembers.email, email)).limit(1)
  )[0];

  if (!member) return null;

  if (member.organizationId) {
    if (!member.isActive) {
      await db.update(teamMembers).set({ isActive: true }).where(eq(teamMembers.id, member.id));
    }
    return { memberId: member.id, organizationId: member.organizationId, role: member.role, name: member.name };
  }

  const domain = email.split("@")[1] ?? "default";
  const isPublicDomain = isPublicEmailDomain(domain);
  let orgSlug: string;

  if (isPublicDomain) {
    orgSlug = email.toLowerCase().replace(/[^a-z0-9]/g, "-");
  } else {
    orgSlug = domain.replace(/\./g, "-");
  }

  let org = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];

  if (!org) {
    const orgName = isPublicDomain
      ? `${member.name || email.split("@")[0]}'s Workspace`
      : `${domain} Organization`;
    const inserted = await db.insert(organizations).values({
      name: orgName,
      slug: orgSlug,
      subscriptionTier: "free",
    }).returning();
    org = inserted[0];
  }

  await db.update(teamMembers).set({ isActive: true, organizationId: org.id }).where(eq(teamMembers.id, member.id));

  return { memberId: member.id, organizationId: org.id, role: member.role, name: member.name };
}

async function createOrgAndMember(
  email: string,
  displayName: string,
): Promise<{ memberId: number; organizationId: number; role: string; name: string }> {
  const domain = email.split("@")[1] ?? "default";
  const isPublicDomain = isPublicEmailDomain(domain);

  let org: typeof organizations.$inferSelect;

  if (isPublicDomain) {
    const userSlug = email.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const inserted = await db.insert(organizations).values({
      name: `${displayName || email.split("@")[0]}'s Workspace`,
      slug: userSlug,
      subscriptionTier: "free",
    }).returning();
    org = inserted[0];
    logger.info({ orgId: org.id, slug: userSlug, email }, "SSO: Created isolated org for public-domain user");
  } else {
    const orgSlug = domain.replace(/\./g, "-");
    const existing = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];
    if (existing) {
      org = existing;
    } else {
      const inserted = await db.insert(organizations).values({
        name: `${domain} Organization`,
        slug: orgSlug,
        subscriptionTier: "free",
      }).returning();
      org = inserted[0];
      logger.info({ orgId: org.id, slug: orgSlug }, "SSO: Created new organization for corporate domain");
    }
  }

  const existingMembers = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.organizationId, org.id)).limit(1);
  const isFirstUser = existingMembers.length === 0;
  const role = isFirstUser ? "admin" : "analyst";

  const inviteCode = crypto.randomBytes(16).toString("hex");
  const inserted = await db.insert(teamMembers).values({
    organizationId: org.id,
    name: displayName || email.split("@")[0],
    email,
    role,
    inviteCode,
    isActive: true,
  }).returning();

  const newMember = inserted[0];
  logger.info(
    { memberId: newMember.id, email, role, isFirstUser, orgId: org.id, isolated: isPublicDomain },
    isFirstUser ? "SSO: First user — assigned admin role" : "SSO: New team member created",
  );

  return { memberId: newMember.id, organizationId: org.id, role, name: newMember.name };
}

async function findOrCreateOrgAndMember(
  email: string,
  displayName: string,
  googleSub: string,
): Promise<{ memberId: number; organizationId: number; role: string; name: string; isNewUser: boolean }> {
  const existing = await findExistingMember(email);
  if (existing) return { ...existing, isNewUser: false };
  const created = await createOrgAndMember(email, displayName);
  return { ...created, isNewUser: true };
}

function createSignedState(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const payload = `${nonce}:${expiresAt}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

function verifySignedState(state: string): boolean {
  const parts = state.split(":");
  if (parts.length !== 3) return false;
  const [nonce, expiresAtStr, sig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || expiresAt < Date.now()) return false;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${nonce}:${expiresAtStr}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function createSignedSetupKey(data: { email: string; name: string; googleSub: string; picture?: string }): string {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifySignedSetupKey(key: string): { email: string; name: string; googleSub: string; picture?: string } | null {
  const dotIdx = key.indexOf(".");
  if (dotIdx === -1) return null;
  const payload = key.slice(0, dotIdx);
  const sig = key.slice(dotIdx + 1);
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

router.get("/sso/start", (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: "Google SSO is not configured (GOOGLE_ADS_CLIENT_ID missing)." });
    return;
  }

  const state = createSignedState();

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/gate/sso/callback`;

  const scopes = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ].join(" ");

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=online` +
    `&prompt=select_account` +
    `&state=${state}`;

  res.redirect(authUrl);
});

router.get("/sso/callback", async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(503).send("Google SSO not configured.");
    return;
  }

  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn({ error }, "SSO: Google returned error");
    const domain = appDomain(req);
    const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
    res.redirect(`https://${domain}${frontendBase}/?sso_error=${encodeURIComponent(error)}`);
    return;
  }

  if (!state || !verifySignedState(state)) {
    res.status(403).send("Invalid OAuth state. Please try signing in again.");
    return;
  }

  const domain = appDomain(req);
  const redirectUri = `https://${domain}/api/auth/gate/sso/callback`;

  try {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      logger.error({ err }, "SSO: Google token exchange failed");
      const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
      res.redirect(`https://${domain}${frontendBase}/?sso_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenResp.json()) as { access_token: string; id_token?: string };

    if (!tokens.access_token) {
      res.status(500).send("No access token received from Google.");
      return;
    }

    const userResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResp.ok) {
      logger.error("SSO: Failed to fetch user profile");
      const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
      res.redirect(`https://${domain}${frontendBase}/?sso_error=profile_fetch_failed`);
      return;
    }

    const userInfo = (await userResp.json()) as {
      id: string;
      email: string;
      name?: string;
      picture?: string;
    };

    if (!userInfo.email) {
      res.status(400).send("Google account does not have an email address.");
      return;
    }

    const existingMember = await findExistingMember(userInfo.email);
    const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";

    if (!existingMember) {
      const setupKey = createSignedSetupKey({
        email: userInfo.email,
        name: userInfo.name ?? "",
        googleSub: userInfo.id,
        picture: userInfo.picture,
      });

      logger.info({ email: userInfo.email }, "SSO: New user detected — awaiting confirmation");

      res.cookie("omni_sso_setup_key", setupKey, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
        path: "/",
      });

      res.redirect(
        `https://${domain}${frontendBase}/?sso_new_user_confirm=1` +
        `&sso_setup_key=${setupKey}` +
        `&sso_name=${encodeURIComponent(userInfo.name ?? "")}` +
        `&sso_email=${encodeURIComponent(userInfo.email)}` +
        (userInfo.picture ? `&sso_picture=${encodeURIComponent(userInfo.picture)}` : ""),
      );
      return;
    }

    const { memberId, organizationId, role, name } = existingMember;

    const token = signGateJwt({
      type: "gate",
      authMethod: "google_sso",
      googleSub: userInfo.id,
      memberId,
      organizationId,
      role,
      name,
      email: userInfo.email,
    });

    // httpOnly so the JWT is never readable from JavaScript on the page.
    // The frontend exchanges this cookie for the token via POST /sso/exchange
    // (handler below) on the next page load, then clears it server-side.
    res.cookie("omni_sso_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 1000,
      path: "/",
    });

    res.redirect(
      `https://${domain}${frontendBase}/?sso_complete=1` +
      `&sso_name=${encodeURIComponent(name)}` +
      `&sso_email=${encodeURIComponent(userInfo.email)}` +
      `&sso_role=${encodeURIComponent(role)}` +
      (userInfo.picture ? `&sso_picture=${encodeURIComponent(userInfo.picture)}` : ""),
    );
  } catch (err) {
    logger.error({ err }, "SSO: Callback error");
    const frontendBase = process.env.FRONTEND_BASE_PATH ?? "";
    res.redirect(`https://${domain}${frontendBase}/?sso_error=internal_error`);
  }
});

router.post("/sso/confirm", async (req, res) => {
  const setupKey = req.cookies?.omni_sso_setup_key || (req.body ?? {}).setupKey;
  if (!setupKey || typeof setupKey !== "string") {
    res.status(400).json({ error: "setupKey is required" });
    return;
  }

  const pending = verifySignedSetupKey(setupKey);
  if (!pending) {
    res.status(410).json({ error: "Setup key expired or invalid. Please sign in again." });
    return;
  }

  res.clearCookie("omni_sso_setup_key", { path: "/" });

  try {
    const existing = await findExistingMember(pending.email);
    let memberId: number, organizationId: number, role: string, name: string;

    if (existing) {
      memberId = existing.memberId;
      organizationId = existing.organizationId;
      role = existing.role;
      name = existing.name;
      logger.info({ memberId, email: pending.email }, "SSO: Confirm hit existing member (race-safe)");
    } else {
      const created = await createOrgAndMember(pending.email, pending.name);
      memberId = created.memberId;
      organizationId = created.organizationId;
      role = created.role;
      name = created.name;
      logger.info({ memberId, email: pending.email }, "SSO: New user confirmed and created");
    }

    const token = signGateJwt({
      type: "gate",
      authMethod: "google_sso",
      googleSub: pending.googleSub,
      memberId,
      organizationId,
      role,
      name,
      email: pending.email,
    });

    // httpOnly: the response body already returns the token to the caller
    // for this confirm endpoint (see res.json below), so the cookie is just
    // a belt-and-suspenders for the immediate post-confirm redirect.
    res.cookie("omni_sso_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 1000,
      path: "/",
    });

    res.json({
      token,
      memberId,
      organizationId,
      role,
      name,
      email: pending.email,
      picture: pending.picture ?? null,
      isNewUser: !existing,
    });
  } catch (err) {
    logger.error({ err }, "SSO: Failed to confirm new user");
    res.status(500).json({ error: "Failed to create account" });
  }
});

// Exchange the short-lived httpOnly omni_sso_token cookie for the JWT in the
// response body. The frontend calls this once on `?sso_complete=1` to receive
// the token and persist it in localStorage, then we clear the cookie. Keeping
// the cookie httpOnly means a malicious script on the page can never read the
// JWT directly during the 60s handoff window.
router.post("/sso/exchange", (req, res) => {
  const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.omni_sso_token;
  if (!cookieToken) {
    res.status(401).json({ error: "no_sso_cookie" });
    return;
  }
  const decoded = verifyGateJwt(cookieToken);
  if (!decoded) {
    res.clearCookie("omni_sso_token", { path: "/" });
    res.status(401).json({ error: "invalid_or_expired" });
    return;
  }
  // Single-use: clear immediately. Subsequent requests use the bearer token.
  res.clearCookie("omni_sso_token", { path: "/" });
  res.json({
    token: cookieToken,
    memberId: decoded.memberId,
    organizationId: decoded.organizationId,
    role: decoded.role,
    name: decoded.name,
    email: decoded.email,
  });
});

router.get("/sso/config", (_req, res) => {
  res.json({
    enabled: !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET,
    passwordGateEnabled: !!SITE_PASSWORD,
  });
});

router.post("/login", (_req, res) => {
  res.status(410).json({
    error: "Password authentication has been retired. Please use Google SSO to sign in.",
    ssoUrl: "/api/auth/gate/sso/start",
  });
});

router.post("/assume-role", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const tokenStr = auth.slice(7);
  const decoded = verifyAnyToken(tokenStr);
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // SECURITY: previously this endpoint let *any* authenticated member of an
  // org mint a token for *any other member* of the same org — a trivial
  // privilege-escalation primitive (member → admin). Restrict to the
  // platform `super_admin` role only, who already bypasses RBAC. Operators
  // wanting "log in as customer" support tooling should use this same path
  // from a super-admin session.
  if (decoded.role !== "super_admin") {
    logger.warn(
      { actorMemberId: decoded.memberId, actorRole: decoded.role, targetMemberId: req.body?.memberId },
      "[security] non-super_admin attempted assume-role",
    );
    res.status(403).json({ error: "assume-role is restricted to platform super admins" });
    return;
  }

  const { memberId } = req.body ?? {};
  if (!memberId || typeof memberId !== "number") {
    res.status(400).json({ error: "memberId (number) is required" });
    return;
  }

  const callerOrgId = decoded.organizationId;
  if (!callerOrgId) {
    res.status(403).json({ error: "Token missing organizationId — cannot assume role" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: teamMembers.id,
        organizationId: teamMembers.organizationId,
        name: teamMembers.name,
        email: teamMembers.email,
        role: teamMembers.role,
        isActive: teamMembers.isActive,
      })
      .from(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.organizationId, callerOrgId)))
      .limit(1);

    const member = rows[0];
    if (!member || !member.isActive) {
      res.status(404).json({ error: "Team member not found or inactive" });
      return;
    }

    const newToken = signGateJwt({
      type: "gate",
      authMethod: decoded.authMethod ?? "password",
      memberId: member.id,
      organizationId: callerOrgId,
      role: member.role,
      name: member.name,
      email: member.email,
    });

    res.json({ token: newToken, member: { id: member.id, name: member.name, role: member.role } });
  } catch (err) {
    logger.error({ err }, "Failed to assume role");
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/verify", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ valid: false });
    return;
  }
  const token = auth.slice(7);
  const decoded = verifyAnyToken(token);
  if (!decoded) {
    res.json({ valid: false });
    return;
  }
  res.json({
    valid: true,
    memberId: decoded.memberId ?? null,
    role: decoded.role ?? null,
    authMethod: decoded.authMethod ?? "password",
    name: decoded.name ?? null,
    email: decoded.email ?? null,
    organizationId: decoded.organizationId ?? null,
  });
});

export default router;
