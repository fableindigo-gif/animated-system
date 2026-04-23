import { Router } from "express";
import OpenAI from "openai";
import { db, organizations, platformConnections, workspaces } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { requireOrgId, UnauthorizedTenantError } from "../../middleware/rbac";
import { decryptCredentials } from "../../lib/credential-helpers";
import { customerFromCreds, formatGoogleAdsError, runSingleMutate } from "../../lib/google-ads/client";

// SSRF guard: only allow https URLs to public hosts when forwarding user-
// supplied imageUrl to upstream ad platforms. Blocks loopback, link-local,
// and RFC1918 ranges so a malicious caller can't pivot to internal services.
function isSafePublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // Numeric IPv4 — block 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 0/8.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  // Crude IPv6 loopback / link-local / unique-local block.
  if (host === "::1" || host.startsWith("[::1]")) return false;
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
}

const router = Router();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

let openai: OpenAI | null = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the caller's organization. Previously fell back to the
 * `slug = "default"` org when no rbacUser was present, which meant any
 * unauthenticated request could read AND deduct credits from the default
 * tenant — a HIGH-severity multi-tenant breach. Now requires a resolved
 * tenant via requireOrgId(req); throws UnauthorizedTenantError (→ 401)
 * otherwise.
 */
async function resolveOrg(req: import("express").Request) {
  const orgId = requireOrgId(req); // throws if no tenant — 401
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org ?? null;
}

// ─── GET /api/ai/creative/credits ─────────────────────────────────────────────
// Returns the organisation's remaining AI Creative Studio credits.
router.get("/credits", async (req, res) => {
  try {
    const org = await resolveOrg(req);
    if (!org) {
      res.status(404).json({ error: "Organisation not found" });
      return;
    }
    res.json({
      credits:     org.aiCreativeCredits,
      hasAddon:    org.aiCreativeCredits > 0,
      configured:  !!openai,
    });
  } catch (err) {
    if (err instanceof UnauthorizedTenantError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    logger.error({ err }, "ai/creative/credits: fetch failed");
    res.status(500).json({ error: "Failed to fetch credits" });
  }
});

// ─── POST /api/ai/creative/generate ──────────────────────────────────────────
// Generates up to `count` ad creative variants using DALL-E 3.
// Requires at least 1 credit. Deducts 1 credit per image generated.
//
// Body: { prompt: string, imageUrl?: string, count?: number (1-4) }
router.post("/generate", async (req, res) => {
  if (!openai) {
    res.status(503).json({
      error:      "AI Creative Studio not configured",
      detail:     "Set OPENAI_API_KEY to enable DALL-E 3 image generation.",
      configured: false,
    });
    return;
  }

  const { prompt, imageUrl, count = 2 } = req.body ?? {};

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
    res.status(400).json({ error: "A descriptive prompt is required (min 5 characters)." });
    return;
  }

  const variantCount = Math.min(Math.max(Number(count) || 2, 1), 4);

  // ── Credit gate ────────────────────────────────────────────────────────────
  // resolveOrg requires a tenant — throws UnauthorizedTenantError (→ 401) so
  // unauthenticated callers can never deduct credits from the default org.
  let org;
  try {
    org = await resolveOrg(req);
  } catch (err) {
    if (err instanceof UnauthorizedTenantError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  if (!org) {
    res.status(404).json({ error: "Organisation not found" });
    return;
  }
  if (org.aiCreativeCredits < variantCount) {
    res.status(402).json({
      error:           "Insufficient AI Creative credits",
      creditsRequired: variantCount,
      creditsAvailable: org.aiCreativeCredits,
      code:            "INSUFFICIENT_CREDITS",
    });
    return;
  }

  // ── Build the enriched prompt ───────────────────────────────────────────────
  // We prepend a quality directive so DALL-E 3 stays consistent with ad-creative standards.
  const fullPrompt = [
    "Professional product advertisement creative for social media.",
    "High-quality, brand-safe, clean background.",
    imageUrl ? `The creative should feature the same product concept as: ${imageUrl}` : "",
    "Instruction:",
    prompt.trim(),
  ].filter(Boolean).join(" ");

  try {
    // DALL-E 3 only supports n=1 per request — parallelise for multiple variants
    const requests = Array.from({ length: variantCount }, (_, i) =>
      openai!.images.generate({
        model:          "dall-e-3",
        prompt:         i === 0 ? fullPrompt : `Variant ${i + 1} of: ${fullPrompt}`,
        size:           "1024x1024",
        quality:        "standard",
        response_format: "url",
        n:              1,
      })
    );

    const results = await Promise.allSettled(requests);
    const images: { url: string; variantIndex: number; revisedPrompt?: string }[] = [];
    let successCount = 0;

    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") {
        const imageData = result.value.data?.[0];
        if (imageData?.url) {
          images.push({
            url:           imageData.url,
            variantIndex:  i,
            revisedPrompt: imageData.revised_prompt,
          });
          successCount++;
        }
      } else {
        logger.warn({ err: result.reason, variant: i }, "DALL-E variant generation failed");
      }
    }

    if (successCount === 0) {
      res.status(502).json({ error: "All image generation attempts failed. Check your OPENAI_API_KEY and quota." });
      return;
    }

    // ── Deduct credits (only for successfully generated images) ────────────
    await db
      .update(organizations)
      .set({ aiCreativeCredits: sql`${organizations.aiCreativeCredits} - ${successCount}` })
      .where(eq(organizations.id, org.id));

    const [updatedOrg] = await db
      .select({ aiCreativeCredits: organizations.aiCreativeCredits })
      .from(organizations)
      .where(eq(organizations.id, org.id));

    logger.info(
      { orgId: org.id, successCount, variantCount, creditsRemaining: updatedOrg?.aiCreativeCredits },
      "ai/creative/generate: images generated, credits deducted",
    );

    res.json({
      images,
      creditsUsed:      successCount,
      creditsRemaining: updatedOrg?.aiCreativeCredits ?? 0,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "ai/creative/generate: OpenAI API error");
    res.status(500).json({ error: "Image generation failed", detail: errMsg });
  }
});

// ─── POST /api/ai/creative/push ───────────────────────────────────────────────
// Pushes an approved creative asset to Meta Ads or Google Ads.
// This submits the asset to the platform's creative library and creates an ad
// variation — the actual platform token must be present in the workspace's
// platform_connections table.
//
// Body: { imageUrl: string, platform: "meta" | "google_ads", campaignId?: string, adSetId?: string, headline?: string }
router.post("/push", async (req, res) => {
  const { imageUrl, platform, campaignId, adSetId, headline } = req.body ?? {};

  if (!imageUrl || typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl is required" });
    return;
  }
  if (!isSafePublicHttpsUrl(imageUrl)) {
    res.status(400).json({ error: "imageUrl must be a public https:// URL (private/loopback ranges are blocked)" });
    return;
  }
  if (!platform || !["meta", "google_ads"].includes(platform)) {
    res.status(400).json({ error: "platform must be 'meta' or 'google_ads'" });
    return;
  }

  try {
    // Attempt to retrieve the platform access token from platform_connections.
    // The connection row stores secrets in a `credentials` JSONB blob; we
    // unpack the named keys we need at the boundary so the rest of this
    // handler stays readable.
    const rbacUser = (req as any).rbacUser;
    const orgId = rbacUser?.organizationId ?? null;

    let connection: typeof platformConnections.$inferSelect | null = null;
    if (orgId) {
      const [conn] = await db
        .select()
        .from(platformConnections)
        .where(
          and(
            eq(platformConnections.organizationId, orgId),
            eq(platformConnections.platform, platform),
          ),
        )
        .limit(1);
      connection = conn ?? null;
    }

    // OAuth writers store accessToken/refreshToken via encryptCredentials, so
    // we MUST decrypt at the boundary before forwarding to the platform —
    // otherwise we'd send ciphertext as a bearer token and every push would
    // fail at runtime (the symptom Meta/Google Ads users would actually see).
    const rawCreds = connection?.credentials ?? {};
    const creds    = Object.keys(rawCreds).length > 0 ? decryptCredentials(rawCreds) : rawCreds;

    const accessToken = creds.accessToken ?? creds.access_token ?? "";
    // Google OAuth writes `customerId`; Meta OAuth writes `adAccountId`. Older
    // shapes used `accountId/account_id`. Accept all common spellings.
    const customerId  = creds.customerId  ?? creds.customer_id  ?? "";
    const adAccountId = creds.adAccountId ?? creds.ad_account_id ?? creds.accountId ?? creds.account_id ?? "";
    const pageId      = creds.pageId      ?? creds.page_id      ?? "";

    if (!accessToken) {
      res.status(503).json({
        error:       `${platform === "meta" ? "Meta" : "Google Ads"} is not connected`,
        detail:      "Connect the platform on the Integrations page first, then retry.",
        configured:  false,
      });
      return;
    }

    // ── Platform push ───────────────────────────────────────────────────────
    if (platform === "meta") {
      // Meta Marketing API — upload image to ad account's image library.
      // The Meta OAuth flow may store the ad account id with or without the
      // `act_` prefix; normalize to the bare numeric id, then prepend `act_`
      // exactly once when composing the URL.
      const bareAdAccountId = adAccountId.replace(/^act_/, "");
      if (!bareAdAccountId) {
        res.status(503).json({ error: "Meta ad account ID not configured on the connection." });
        return;
      }

      const formData = new URLSearchParams({
        url:          imageUrl,
        access_token: accessToken,
      });

      const uploadResp = await fetch(
        `https://graph.facebook.com/v19.0/act_${bareAdAccountId}/adimages`,
        { method: "POST", body: formData },
      );

      if (!uploadResp.ok) {
        const body = await uploadResp.text();
        logger.error({ status: uploadResp.status, body }, "Meta image upload failed");
        res.status(502).json({ error: "Meta image upload failed", detail: body });
        return;
      }
      const uploadData = await uploadResp.json() as { images?: Record<string, { hash: string }> };
      const firstKey = uploadData.images ? Object.keys(uploadData.images)[0] : null;
      const imageHash = firstKey ? uploadData.images![firstKey]?.hash : null;

      if (!imageHash) {
        res.status(502).json({ error: "Meta did not return an image hash", raw: uploadData });
        return;
      }

      // Create ad creative
      const creativePayload = new URLSearchParams({
        name:         `OmniAnalytix AI Creative — ${Date.now()}`,
        object_story_spec: JSON.stringify({
          page_id:              pageId || adAccountId,
          link_data: {
            image_hash: imageHash,
            message:    headline ?? "New creative",
            link:       "https://example.com",
          },
        }),
        access_token: accessToken,
      });

      const creativeResp = await fetch(
        `https://graph.facebook.com/v19.0/act_${bareAdAccountId}/adcreatives`,
        { method: "POST", body: creativePayload },
      );

      const creativeData = await creativeResp.json() as { id?: string; error?: { message: string } };
      if (!creativeResp.ok || creativeData.error) {
        res.status(502).json({ error: "Meta ad creative creation failed", detail: creativeData.error?.message });
        return;
      }

      logger.info({ orgId: connection?.organizationId, creativeId: creativeData.id }, "Meta creative pushed");
      res.json({ success: true, platform: "meta", creativeId: creativeData.id, imageHash });
      return;
    }

    if (platform === "google_ads") {
      // Google Ads Mutate API — upload image asset
      // Full implementation requires the Google Ads client library and customer ID
      if (!customerId) {
        res.status(503).json({ error: "Google Ads customer ID not configured on the connection." });
        return;
      }

      // Download the image and encode as base64 for Google Ads asset upload
      const imageResp = await fetch(imageUrl);
      if (!imageResp.ok) {
        res.status(502).json({ error: "Failed to download image for Google Ads upload" });
        return;
      }
      const imageBuffer = Buffer.from(await imageResp.arrayBuffer());
      const base64Data  = imageBuffer.toString("base64");

      const normalizedGadsCreds: Record<string, string> = {
        ...creds,
        customerId:       creds.customerId       ?? creds.customer_id       ?? customerId,
        refreshToken:     creds.refreshToken     ?? creds.refresh_token     ?? "",
        managerCustomerId: creds.managerCustomerId ?? creds.manager_customer_id ?? creds.loginCustomerId ?? "",
      };
      if (!normalizedGadsCreds.refreshToken) {
        res.status(503).json({ error: "Google Ads connection missing refresh token — re-authorize on the Connections page." });
        return;
      }

      let resourceName: string | undefined;
      try {
        const gadsCustomer = customerFromCreds(normalizedGadsCreds);
        const result = await runSingleMutate(gadsCustomer, {
          entity: "asset" as const,
          operation: "create" as const,
          resource: {
            name:        `OmniAnalytix AI Creative ${Date.now()}`,
            type:        4,
            image_asset: { data: base64Data },
          } as Record<string, unknown>,
        });
        if (!result.ok) {
          const detail = result.failures.map((f) => f.message).join("; ");
          logger.error({ failures: result.failures }, "Google Ads asset upload failed");
          res.status(502).json({ error: "Google Ads asset upload failed", detail });
          return;
        }
        resourceName = result.resourceName;
      } catch (sdkErr) {
        const detail = formatGoogleAdsError(sdkErr);
        logger.error({ detail }, "Google Ads asset upload failed");
        res.status(502).json({ error: "Google Ads asset upload failed", detail });
        return;
      }

      logger.info({ customerId, resourceName }, "Google Ads image asset pushed");
      res.json({ success: true, platform: "google_ads", resourceName });
      return;
    }
  } catch (err) {
    logger.error({ err }, "ai/creative/push: unexpected error");
    res.status(500).json({ error: "Failed to push creative" });
  }
});

export default router;
