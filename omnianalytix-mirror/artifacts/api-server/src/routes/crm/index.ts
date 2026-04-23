import { Router } from "express";
import crypto from "crypto";
import { db, platformConnections } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getFreshGoogleCredentials } from "../../lib/google-token-refresh";
import { googleAds_pushCustomerMatchList } from "../../lib/platform-executors";
import { logger } from "../../lib/logger";
import { getOrgId } from "../../middleware/rbac";

const router = Router();

// ─── POST /api/crm/audiences/sync ────────────────────────────────────────────
//
// Accepts a segment name and an array of customer emails, SHA-256 hashes them
// per Google Customer Match requirements (lowercase + trim), then pushes to the
// Google Ads Customer Match API.
//
// Body (JSON):
//   segment_name    string          e.g. "VIPs 60-Day Lapsed"
//   customer_emails string[]        raw email addresses (plaintext)
//   user_list_id    string          Google Ads Customer Match list ID
//
// Returns:
//   uploaded_count  number          emails successfully queued for upload
//   hashed_count    number          how many were hashed (sanity check)
//   segment_name    string
//   match_note      string          reminder about 24-48h match rate delay

router.post("/audiences/sync", async (req, res) => {
  const { segment_name, customer_emails, user_list_id } = req.body as {
    segment_name?: string;
    customer_emails?: unknown;
    user_list_id?: string;
  };

  if (!segment_name) {
    res.status(400).json({ error: "segment_name is required" });
    return;
  }
  if (!user_list_id) {
    res.status(400).json({ error: "user_list_id is required (Google Ads Customer Match list ID)" });
    return;
  }
  if (!Array.isArray(customer_emails) || customer_emails.length === 0) {
    res.status(400).json({ error: "customer_emails must be a non-empty array of email strings" });
    return;
  }

  // ── SHA-256 hash each email (lowercase + trim per Google spec) ────────────
  const hashed: string[] = (customer_emails as unknown[])
    .filter((e) => typeof e === "string" && e.includes("@"))
    .map((e) =>
      crypto
        .createHash("sha256")
        .update((e as string).toLowerCase().trim())
        .digest("hex"),
    );

  if (!hashed.length) {
    res.status(400).json({ error: "No valid email addresses found in customer_emails" });
    return;
  }

  try {
    // ── Check Google Ads connection ────────────────────────────────────────────
    const orgId = getOrgId(req);
    const connConditions = [eq(platformConnections.platform, "google_ads")];
    connConditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
    const [gadsConn] = await db
      .select()
      .from(platformConnections)
      .where(and(...connConditions));

    if (!gadsConn?.isActive) {
      res.status(400).json({ error: "Google Ads is not connected. Connect it on the Connections page first." });
      return;
    }

    const creds = await getFreshGoogleCredentials("google_ads", orgId);
    if (!creds) {
      res.status(401).json({ error: "Failed to get fresh Google Ads credentials." });
      return;
    }

    // ── Push hashed emails to Google Ads Customer Match ───────────────────────
    const result = await googleAds_pushCustomerMatchList(creds, user_list_id, hashed);

    logger.info(
      { segment_name, user_list_id, total_emails: customer_emails.length, hashed_count: hashed.length },
      "CRM audience sync completed",
    );

    res.json({
      success:        result.success,
      segment_name,
      user_list_id,
      total_submitted: customer_emails.length,
      hashed_count:   hashed.length,
      uploaded_count: hashed.length,
      message:        result.message,
      match_note:     "Google Ads Customer Match rates update within 24-48 hours. Segment must have ≥1,000 matched users to be targetable.",
    });
  } catch (err) {
    logger.error({ err }, "CRM audience sync route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
