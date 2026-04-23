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
 * Send an email via Resend's HTTP API. We use plain fetch instead of the
 * `resend` SDK to avoid a heavy dependency for one endpoint and to keep
 * this file dependency-free.
 *
 * Returns true on a successful send. Errors are caught and logged by the
 * caller — never thrown into the request hot path.
 */
async function sendEmailViaResend(opts: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
}): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    }),
  });
  return res.ok;
}

/**
 * Notify org admins about an access request.
 *
 * Delivery channels (in priority order):
 *   1. In-app: the request row is already persisted — admins see it under
 *      Settings → Access requests. (Handled by the caller.)
 *   2. Email: when RESEND_API_KEY + ACCESS_REQUEST_FROM_EMAIL are set, send
 *      a transactional email via Resend's HTTP API.
 *   3. Structured log: always emit a structured pino log so deployments
 *      without email infra still have an auditable trail and so future
 *      mail providers (SES/SendGrid/etc.) can be wired in by replacing
 *      `sendEmailViaResend` without changing callers.
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
}): Promise<{ adminCount: number; emailSent: boolean; recipients: AdminContact[] }> {
  try {
    const admins = await listOrgAdmins(input.organizationId);
    if (admins.length === 0) {
      input.log.info({ orgId: input.organizationId }, "[access-request] no admins to notify");
      return { adminCount: 0, emailSent: false, recipients: [] };
    }

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

    const recipients = admins.map((a) => a.email).filter((e): e is string => !!e && e.includes("@"));

    // Always emit the audit log — both for ops visibility and so deployments
    // without email configured still surface the notification somewhere.
    input.log.info(
      {
        kind: "access_request_notification",
        organizationId: input.organizationId,
        recipients,
        subject,
      },
      "[access-request] notifying admins",
    );

    // Real email dispatch when configured. RESEND_API_KEY may be absent in
    // dev/preview deployments — that's fine, the in-app inbox is the
    // primary surface. Failures are logged, never thrown.
    let emailSent = false;
    const apiKey = process.env.RESEND_API_KEY;
    const from   = process.env.ACCESS_REQUEST_FROM_EMAIL;
    if (apiKey && from && recipients.length > 0) {
      try {
        emailSent = await sendEmailViaResend({ apiKey, from, to: recipients, subject, text: body });
        if (!emailSent) {
          input.log.warn({ recipients }, "[access-request] resend dispatch returned non-2xx");
        }
      } catch (err) {
        input.log.error({ err }, "[access-request] resend dispatch threw (non-fatal)");
      }
    } else {
      input.log.debug(
        { hasApiKey: !!apiKey, hasFrom: !!from },
        "[access-request] email provider not configured — relying on in-app inbox",
      );
    }

    return { adminCount: admins.length, emailSent, recipients: admins };
  } catch (err) {
    input.log.error({ err }, "[access-request] notification dispatch failed (non-fatal)");
    return { adminCount: 0, emailSent: false, recipients: [] };
  }
}
