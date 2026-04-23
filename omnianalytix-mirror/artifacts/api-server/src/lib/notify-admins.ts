import type { Logger } from "pino";
import { and, eq, isNull } from "drizzle-orm";
import { db, teamMembers } from "@workspace/db";

export interface AdminContact {
  id: number;
  name: string;
  email: string;
}

/**
 * Look up active workspace admins for an org. Used by the access-request
 * dispatcher (and re-usable elsewhere) to know who to notify.
 */
export async function listOrgAdmins(orgId: number | null): Promise<AdminContact[]> {
  const orgFilter = orgId != null
    ? eq(teamMembers.organizationId, orgId)
    : isNull(teamMembers.organizationId);
  // tenant-ownership-skip: orgFilter constrains to the caller's org.
  const rows = await db
    .select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, role: teamMembers.role, isActive: teamMembers.isActive })
    .from(teamMembers)
    .where(and(orgFilter, eq(teamMembers.role, "admin"), eq(teamMembers.isActive, true)));
  return rows.map((r) => ({ id: r.id, name: r.name ?? "", email: r.email ?? "" }));
}

/**
 * Notify org admins about an access request.
 *
 * NOTE: We don't yet have an email/transactional provider wired up in this
 * monorepo. Until one is added, this dispatcher logs the notification in a
 * structured format so it can be tailed by ops, surfaced through Replit
 * deployment logs, or scraped by a future SES/SendGrid/Resend bridge. The
 * in-app surface (admin "Access requests" tab) is the primary delivery
 * mechanism; this is the email-equivalent best-effort path.
 *
 * Always fire-and-forget — never let a notification failure block the
 * underlying request from being recorded.
 */
export async function notifyAdminsOfAccessRequest(input: {
  organizationId: number | null;
  requesterName: string;
  requesterEmail: string;
  requesterRole: string;
  actionLabel: string;
  actionContext: string;
  reason: string;
  log: Logger;
}): Promise<{ adminCount: number; recipients: AdminContact[] }> {
  try {
    const admins = await listOrgAdmins(input.organizationId);
    if (admins.length === 0) {
      input.log.info({ orgId: input.organizationId }, "[access-request] no admins to notify");
      return { adminCount: 0, recipients: [] };
    }

    // Structured "email" payload — when a transactional provider is wired
    // up, the body of this fn becomes its `client.send()` call.
    const subject = `[OmniAnalytix] ${input.requesterName} requests access for "${input.actionLabel}"`;
    const body = [
      `${input.requesterName} (${input.requesterEmail}, role: ${input.requesterRole}) requested permission to run:`,
      ``,
      `  Action: ${input.actionLabel}`,
      input.actionContext ? `  Context: ${input.actionContext}` : "",
      input.reason ? `  Reason: ${input.reason}` : "",
      ``,
      `Open settings → Access requests to grant or dismiss this request.`,
    ].filter(Boolean).join("\n");

    input.log.info(
      {
        kind: "access_request_notification",
        organizationId: input.organizationId,
        recipients: admins.map((a) => a.email).filter(Boolean),
        subject,
        body,
      },
      "[access-request] notifying admins",
    );

    return { adminCount: admins.length, recipients: admins };
  } catch (err) {
    input.log.error({ err }, "[access-request] notification dispatch failed (non-fatal)");
    return { adminCount: 0, recipients: [] };
  }
}
