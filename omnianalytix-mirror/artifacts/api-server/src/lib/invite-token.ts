import jwt from "jsonwebtoken";

const SECRET =
  process.env.INVITE_JWT_SECRET ??
  "dev-invite-jwt-secret-replace-in-production";

const EXPIRY = "48h";

export interface InvitePayload {
  memberId: number;
  email: string;
  role: string;
  workspaceId: number | null;
  organizationId: number | null;
  type: "team" | "client";
}

/**
 * Generate a signed JWT invite token. Expires in 48 h.
 * The token is stored in `team_members.inviteCode` so that
 * `invitePending === true` acts as the "not yet consumed" gate.
 */
export function generateInviteToken(payload: InvitePayload): string {
  return jwt.sign(
    {
      sub: String(payload.memberId),
      email: payload.email,
      role: payload.role,
      workspaceId: payload.workspaceId,
      organizationId: payload.organizationId,
      type: payload.type,
    },
    SECRET,
    { expiresIn: EXPIRY },
  );
}

export interface VerifiedInvitePayload extends InvitePayload {
  exp: number;
  iat: number;
}

/**
 * Verify a JWT invite token. Throws if expired or tampered.
 */
export function verifyInviteToken(token: string): VerifiedInvitePayload {
  const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
  return {
    memberId: parseInt(decoded.sub!, 10),
    email: decoded.email as string,
    role: decoded.role as string,
    workspaceId: (decoded.workspaceId as number | null) ?? null,
    organizationId: (decoded.organizationId as number | null) ?? null,
    type: decoded.type as "team" | "client",
    exp: decoded.exp!,
    iat: decoded.iat!,
  };
}
