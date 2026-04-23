import { useEffect, useState } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useDashboardStore } from "@/store/dashboardStore";
import { formatUsdInDisplay } from "@/lib/fx-format";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface MarginLeak {
  campaignName: string | null;
  campaignId: string;
  productTitle: string | null;
  sku: string | null;
  inventoryQty: number | null;
  wastedSpend: number;
  impressions: number;
}

interface MarginLeaksResponse {
  data?: MarginLeak[];
  leaks?: MarginLeak[];
}

const STORAGE_KEY = "omni_first_insight_dismissed_v1";

/**
 * Hero banner shown above the dashboard when we have a real, dollarised
 * insight to celebrate — currently the largest open margin-leak. This is
 * the user-facing payoff of the first-sync hook (etl-state.wasFirstSync)
 * and complements the structured `first_sync_completed` log event the
 * api-server emits.
 *
 * Dismissed state is persisted per-workspace in localStorage so the celebration
 * doesn't follow the user around forever once they've engaged with it.
 */
export function FirstInsightHero({ onOpenDashboard }: { onOpenDashboard?: () => void }) {
  const { activeWorkspace } = useWorkspace();
  const syncState = useDashboardStore((s) => s.syncState);
  const [topLeak, setTopLeak] = useState<MarginLeak | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  // We only celebrate "first value" when the api-server reports that the
  // most recent successful sync was the first ever for this server. Once
  // the user dismisses the celebration this gate is irrelevant.
  const [wasFirstSync, setWasFirstSync] = useState<boolean>(false);

  const storageKey = activeWorkspace?.id != null
    ? `${STORAGE_KEY}:${activeWorkspace.id}`
    : null;

  // Hydrate dismissed flag whenever the workspace changes.
  useEffect(() => {
    if (!storageKey) { setDismissed(false); return; }
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch { setDismissed(false); }
  }, [storageKey]);

  // Poll the ETL status to learn whether the most recent completed sync was
  // the very first one. We only want to celebrate "first value" — not every
  // subsequent operational rehydration.
  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}api/etl/status`);
        if (!res.ok) return;
        const json = (await res.json()) as { etlWasFirstSync?: boolean };
        if (!cancelled) setWasFirstSync(Boolean(json.etlWasFirstSync));
      } catch {
        // silent — leave gate closed
      }
    })();
    return () => { cancelled = true; };
  }, [syncState, dismissed, activeWorkspace?.id]);

  // Only fetch leaks once the warehouse is populated AND this is genuinely
  // the first-sync celebration window.
  useEffect(() => {
    if (dismissed || !wasFirstSync) return;
    if (syncState !== "OPERATIONAL_POPULATED" && syncState !== "STALE_DATA") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}api/warehouse/margin-leaks?days=30`);
        if (!res.ok) return;
        const json = (await res.json()) as MarginLeaksResponse;
        const leaks = json.data ?? json.leaks ?? [];
        const top = [...leaks].sort((a, b) => (b.wastedSpend ?? 0) - (a.wastedSpend ?? 0))[0] ?? null;
        if (!cancelled && top && top.wastedSpend > 0) setTopLeak(top);
      } catch {
        // silent — we just don't show the hero
      }
    })();
    return () => { cancelled = true; };
  }, [syncState, dismissed, wasFirstSync, activeWorkspace?.id]);

  if (dismissed || !wasFirstSync || !topLeak) return null;

  const handleDismiss = () => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, "1"); } catch { /* quota */ }
    }
    setDismissed(true);
  };

  const subjectLabel = topLeak.productTitle ?? topLeak.sku ?? topLeak.campaignName ?? "an ad";
  const wasted = formatUsdInDisplay(topLeak.wastedSpend, { compact: true, decimals: 0 });

  return (
    <div
      data-testid="first-insight-hero"
      className="px-4 py-3 border-b border-emerald-300/40 bg-gradient-to-r from-emerald-50 via-white to-emerald-50/30 shrink-0"
    >
      <div className="max-w-4xl mx-auto flex items-start gap-4">
        <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-[18px] h-[18px] text-emerald-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
            First insight ready
          </p>
          <p className="text-sm font-bold text-on-surface mt-0.5">
            We found {wasted} of wasted spend on {subjectLabel}
            {topLeak.inventoryQty === 0 ? " — it's out of stock." : "."}
          </p>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Open the dashboard to triage this leak and review every other anomaly we surfaced from your first sync.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onOpenDashboard && (
            <button
              type="button"
              onClick={onOpenDashboard}
              className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors"
              data-testid="first-insight-open-dashboard"
            >
              View leak
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss first-insight banner"
            className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-low transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
