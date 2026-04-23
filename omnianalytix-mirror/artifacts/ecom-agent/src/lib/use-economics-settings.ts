/**
 * useEconomicsSettings — fetch the per-tenant COGS % and target ROAS
 * configured by the agency (Task #153).
 *
 * Falls back to the dashboard's portfolio defaults when the tenant has
 * not configured their own values, so brand-new orgs see sensible numbers.
 *
 * Returns helpers:
 *   - `cogsPct(fallback)`         — resolved COGS fraction
 *   - `targetRoasFor(campaignId)` — resolved per-campaign target ROAS
 *     (falls back to the org default, then the supplied default).
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { authFetch } from "@/lib/auth-fetch";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

export interface EconomicsSettings {
  cogsPct:           number | null;
  targetRoas:        number | null;
  campaignOverrides: Record<string, number>;
}

interface UseEconomicsResult {
  settings: EconomicsSettings | null;
  loading:  boolean;
  error:    string | null;
  refresh:  () => Promise<void>;
  /** Resolve COGS fraction with a caller-provided fallback. */
  cogsPctOr: (fallback: number) => number;
  /** Resolve target ROAS for a campaign, falling back to org default → supplied default. */
  targetRoasFor: (campaignId: string | null | undefined, fallback: number) => number;
  /**
   * Persist a per-campaign target ROAS override (Task #164).
   * Pass `null` to clear the override and fall back to the org default.
   * Optimistically updates local settings from the API response.
   */
  setCampaignTargetRoas: (campaignId: string, targetRoas: number | null) => Promise<void>;
}

const EMPTY: EconomicsSettings = { cogsPct: null, targetRoas: null, campaignOverrides: {} };

export function useEconomicsSettings(): UseEconomicsResult {
  const [settings, setSettings] = useState<EconomicsSettings | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}api/settings/economics`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as Partial<EconomicsSettings>;
      setSettings({
        cogsPct:           typeof data.cogsPct    === "number" ? data.cogsPct    : null,
        targetRoas:        typeof data.targetRoas === "number" ? data.targetRoas : null,
        campaignOverrides: data.campaignOverrides ?? {},
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSettings(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const cogsPctOr = useCallback(
    (fallback: number) => settings?.cogsPct ?? fallback,
    [settings],
  );

  const targetRoasFor = useCallback(
    (campaignId: string | null | undefined, fallback: number) => {
      const override = campaignId ? settings?.campaignOverrides?.[campaignId] : undefined;
      if (typeof override === "number" && Number.isFinite(override) && override > 0) return override;
      if (settings?.targetRoas != null && Number.isFinite(settings.targetRoas) && settings.targetRoas > 0) {
        return settings.targetRoas;
      }
      return fallback;
    },
    [settings],
  );

  const setCampaignTargetRoas = useCallback(
    async (campaignId: string, targetRoas: number | null) => {
      const res = await authFetch(
        `${API_BASE}api/settings/economics/campaigns/${encodeURIComponent(campaignId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetRoas }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Partial<EconomicsSettings>;
      setSettings({
        cogsPct:           typeof data.cogsPct    === "number" ? data.cogsPct    : null,
        targetRoas:        typeof data.targetRoas === "number" ? data.targetRoas : null,
        campaignOverrides: data.campaignOverrides ?? {},
      });
    },
    [],
  );

  return useMemo(
    () => ({ settings, loading, error, refresh, cogsPctOr, targetRoasFor, setCampaignTargetRoas }),
    [settings, loading, error, refresh, cogsPctOr, targetRoasFor, setCampaignTargetRoas],
  );
}
