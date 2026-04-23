/**
 * Shared Google Ads SDK client factory.
 *
 * Wraps the official-style `google-ads-api` Node client (Opteo's MIT-licensed
 * client built on top of the Google-maintained `google-ads-node` gRPC stubs).
 * Centralises:
 *   - developer-token + OAuth client-id/secret loading (env-first)
 *   - per-customer login-customer-id wiring
 *   - API version pinning (single constant — bump in one place)
 *   - typed mutate helpers with validate-only and partial-failure plumbing
 *
 * Read-only GAQL reporting still goes through GAARF in `lib/gaarf/client.ts`
 * for ad-hoc/template queries; this module is for typed mutates and inline
 * Customer.query() reads from the platform fetchers.
 */
import { GoogleAdsApi, Customer, MutateOperation, errors } from "google-ads-api";
import { eq, and, isNull } from "drizzle-orm";
import { db, platformConnections } from "@workspace/db";
import { logger } from "../logger";
import { getFreshGoogleCredentials } from "../google-token-refresh";
import { decryptCredentials } from "../credential-helpers";

// ── Pin the Google Ads API version in exactly one place ─────────────────────
// google-ads-api@23 wraps Google Ads API v23; bumping the package upgrades
// this constant in lockstep. Importers should reference this rather than
// hard-coding "v20"/"v23" anywhere else in the codebase.
export const GOOGLE_ADS_API_VERSION = "v23" as const;

let cachedClient: GoogleAdsApi | null = null;

/** Build (or return the cached) GoogleAdsApi client. */
export function getGoogleAdsClient(): GoogleAdsApi {
  if (cachedClient) return cachedClient;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";
  if (!developerToken || !clientId || !clientSecret) {
    throw new Error(
      "Google Ads SDK not configured: set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET.",
    );
  }
  cachedClient = new GoogleAdsApi({
    developer_token: developerToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  return cachedClient;
}

export interface BuildCustomerOpts {
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
}

/** Build a Customer service from raw refresh-token + customer ids. */
export function buildCustomer(opts: BuildCustomerOpts): Customer {
  const client = getGoogleAdsClient();
  const customerId = opts.customerId.replace(/-/g, "");
  const loginId = (opts.loginCustomerId ?? opts.customerId).replace(/-/g, "");
  return client.Customer({
    customer_id: customerId,
    login_customer_id: loginId,
    refresh_token: opts.refreshToken,
  });
}

/**
 * Build a Customer service from a credential map (e.g. the result of
 * `getFreshGoogleCredentials`/`decryptCredentials`).
 */
export function customerFromCreds(creds: Record<string, string>): Customer {
  if (!creds.refreshToken) {
    throw new Error("Google Ads credentials missing refreshToken — re-authorize the connection.");
  }
  if (!creds.customerId) {
    throw new Error("Google Ads credentials missing customerId.");
  }
  return buildCustomer({
    refreshToken: creds.refreshToken,
    customerId: creds.customerId,
    loginCustomerId: creds.managerCustomerId || creds.loginCustomerId,
  });
}

/** Look up creds for an org, refresh access token, build a Customer. */
export async function customerForOrg(orgId?: number | null): Promise<Customer> {
  const fresh = await getFreshGoogleCredentials("google_ads", orgId ?? undefined);
  if (fresh) return customerFromCreds(fresh);
  const conditions = [eq(platformConnections.platform, "google_ads")];
  conditions.push(orgId != null ? eq(platformConnections.organizationId, orgId) : isNull(platformConnections.organizationId));
  const rows = await db.select().from(platformConnections).where(and(...conditions));
  if (!rows.length) throw new Error("No Google Ads connection found for this organisation.");
  return customerFromCreds(decryptCredentials(rows[0].credentials as Record<string, string>));
}

// ── Mutate helpers ──────────────────────────────────────────────────────────

export interface MutateExecOptions {
  /**
   * If true, the request runs server-side validation but does NOT persist
   * the change. Used by the Approval Queue to preview the effect of a
   * mutation before the user confirms.
   */
  validateOnly?: boolean;
}

export interface PartialFailureItem {
  /** Index into the operations array; -1 if Google didn't pinpoint an op. */
  index: number;
  message: string;
}

/**
 * Pull per-operation errors out of a partial_failure_error payload so the
 * caller can surface them individually instead of as one opaque failure.
 */
export function extractPartialFailures(response: unknown): PartialFailureItem[] {
  const r = response as {
    partial_failure_error?: {
      message?: string;
      details?: Array<{
        errors?: Array<{
          message?: string;
          location?: { field_path_elements?: Array<{ field_name?: string; index?: number | null }> };
        }>;
      }>;
    };
  };
  const out: PartialFailureItem[] = [];
  if (!r?.partial_failure_error) return out;
  for (const detail of r.partial_failure_error.details ?? []) {
    for (const e of detail.errors ?? []) {
      const opIdx = e.location?.field_path_elements?.find((p) => p.field_name === "operations")?.index;
      out.push({ index: typeof opIdx === "number" ? opIdx : -1, message: e.message ?? "Unknown Google Ads error" });
    }
  }
  if (!out.length && r.partial_failure_error.message) {
    out.push({ index: -1, message: r.partial_failure_error.message });
  }
  return out;
}

/** Format a thrown Google Ads error (GoogleAdsFailure or generic) into a single message. */
export function formatGoogleAdsError(err: unknown): string {
  if (err instanceof errors.GoogleAdsFailure) {
    const msgs = (err.errors ?? []).map((e) => e.message).filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  const e = err as { errors?: Array<{ message?: string }>; message?: string };
  if (e?.errors?.length) {
    const msgs = e.errors.map((x) => x.message).filter(Boolean) as string[];
    if (msgs.length) return msgs.join("; ");
  }
  return e?.message ?? String(err);
}

/**
 * Run a single typed mutate operation with partial-failure enabled.
 *
 * Returns either:
 *   - { ok: true } on success
 *   - { ok: false, failures } when the API returned partial_failure_error
 *   - throws if the request itself failed (network/auth)
 */
export async function runSingleMutate<T>(
  customer: Customer,
  op: MutateOperation<T>,
  opts: MutateExecOptions = {},
): Promise<{ ok: true; resourceName?: string } | { ok: false; failures: PartialFailureItem[] }> {
  const response = await customer.mutateResources([op], {
    validate_only: !!opts.validateOnly,
    partial_failure: true,
  });
  const failures = extractPartialFailures(response);
  if (failures.length) {
    return { ok: false, failures };
  }
  // Pull the resource_name from the first mutate result if present.
  const results = (response as unknown as { mutate_operation_responses?: Array<Record<string, { resource_name?: string }>> })
    .mutate_operation_responses ?? [];
  let resourceName: string | undefined;
  for (const r of results) {
    for (const v of Object.values(r)) {
      if (v?.resource_name) { resourceName = v.resource_name; break; }
    }
    if (resourceName) break;
  }
  return { ok: true, resourceName };
}
