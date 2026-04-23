import { useState, useEffect, useCallback, useRef } from "react";
import { LookerEmbedSDK } from "@looker/embed-sdk";
import { authFetch } from "@/lib/auth-fetch";
import { useDateRange } from "@/contexts/date-range-context";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

let sdkInitialized = false;

function initLookerSDK() {
  if (sdkInitialized) return;
  LookerEmbedSDK.init(`${API_BASE}api/looker`, {
    url: `${API_BASE}api/looker/auth`,
    withCredentials: true,
  });
  sdkInitialized = true;
}

interface LookerDashboard {
  id: string;
  title: string;
  description: string;
  category: string;
}

interface EmbedSession {
  embedUrl: string;
  dashboardId: string;
  features: {
    sharing: boolean;
    downloading: boolean;
    filtering: boolean;
  };
}

export function LookerVisualizationHub() {
  const { dateRange } = useDateRange();
  const [dashboards, setDashboards] = useState<LookerDashboard[]>([]);
  const [activeDashboard, setActiveDashboard] = useState<LookerDashboard | null>(null);
  const [embedSession, setEmbedSession] = useState<EmbedSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const embedContainerRef = useRef<HTMLDivElement>(null);

  const fromIso = dateRange.from.toISOString().slice(0, 10);
  const toIso   = dateRange.to.toISOString().slice(0, 10);
  // Monotonic request token so out-of-order responses (after rapid date or
  // dashboard switches) don't clobber the latest user intent.
  const loadTokenRef = useRef(0);

  useEffect(() => {
    initLookerSDK();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}api/looker/dashboards`);
        if (res.ok) {
          const data = await res.json();
          setDashboards(data.dashboards || []);
          if (data.dashboards?.length > 0) {
            setActiveDashboard(data.dashboards[0]);
          }
        }
      } catch {
        setDashboards([
          { id: "1", title: "E-Commerce Overview", description: "Revenue, orders, and conversion trends", category: "ecom" },
          { id: "2", title: "Ad Performance Matrix", description: "Cross-platform ROAS and spend analysis", category: "ads" },
          { id: "3", title: "Lead Pipeline Funnel", description: "Lead-to-customer journey with CRM data", category: "leadgen" },
          { id: "4", title: "Attribution & CAC", description: "Multi-touch attribution and customer acquisition cost", category: "hybrid" },
        ]);
      }
    })();
  }, []);

  const loadEmbed = useCallback(async (dashboard: LookerDashboard) => {
    const myToken = ++loadTokenRef.current;
    setActiveDashboard(dashboard);
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        dashboard_id: dashboard.id,
        date_range_start: fromIso,
        date_range_end:   toIso,
      });
      const res = await authFetch(`${API_BASE}api/looker/auth?${qs.toString()}`);
      if (myToken !== loadTokenRef.current) return; // superseded
      if (!res.ok) throw new Error("Failed to authenticate");
      const session = await res.json() as EmbedSession;
      if (myToken !== loadTokenRef.current) return; // superseded
      // The date range is baked into the SSO target_url server-side
      // (`/api/looker/auth` signs it), so we leave the embed URL untouched —
      // mutating the signed URL here would invalidate Looker's signature.
      setEmbedSession(session);

      if (embedContainerRef.current) {
        embedContainerRef.current.innerHTML = "";
        try {
          const builder = LookerEmbedSDK.createDashboardWithId(dashboard.id);
          const withParams = (builder as unknown as {
            withParams?: (params: Record<string, string>) => typeof builder;
          }).withParams;
          if (typeof withParams === "function") {
            withParams.call(builder, {
              date_range_start: fromIso,
              date_range_end:   toIso,
              filter_date:      `${fromIso} to ${toIso}`,
            });
          }
          await builder
            .withAllowAttr("fullscreen")
            .appendTo(embedContainerRef.current)
            .build()
            .connect();
        } catch {
          // SDK embed failed — fall back to signed URL iframe below
        }
      }
    } catch (err) {
      setError("Looker embed authentication failed. Ensure your Looker credentials are configured.");
    } finally {
      setLoading(false);
    }
  }, [fromIso, toIso]);

  // Re-load the active embed whenever the global date range changes so the
  // iframe URL (and SDK params) pick up the new window.
  useEffect(() => {
    if (activeDashboard) {
      void loadEmbed(activeDashboard);
    }
    // We intentionally exclude `activeDashboard` and `loadEmbed` to avoid
    // re-loading on every render; the dashboard switch already calls loadEmbed
    // directly. Only date-range changes should trigger this reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIso, toIso]);

  const categoryIcon: Record<string, string> = {
    ecom: "shopping_cart",
    ads: "campaign",
    leadgen: "contact_page",
    hybrid: "hub",
  };

  const categoryColor: Record<string, string> = {
    ecom: "bg-emerald-50 text-emerald-600 border-emerald-200",
    ads: "bg-primary-container/10 text-primary-container border-primary-container/20",
    leadgen: "bg-violet-50 text-violet-600 border-violet-200",
    hybrid: "bg-amber-50 text-amber-600 border-amber-200",
  };

  const sdkEmbedActive = embedContainerRef.current && embedContainerRef.current.childElementCount > 0;

  return (
    <section className="bg-white rounded-2xl shadow-sm border ghost-border overflow-hidden">
      <div className="px-5 py-4 border-b ghost-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-primary-container/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary-container" style={{ fontSize: 20 }}>
              analytics
            </span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Looker Visualization Hub</h3>
            <p className="text-[11px] text-on-surface-variant tracking-wider font-mono mt-0.5">
              EMBEDDED BI DASHBOARDS
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface-variant hover:text-on-surface-variant transition-colors px-3 py-1.5 rounded-2xl hover:bg-surface"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {isExpanded ? "collapse_all" : "expand_all"}
          </span>
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      </div>

      <div className="px-5 py-3">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {dashboards.map((d) => (
            <button
              key={d.id}
              onClick={() => loadEmbed(d)}
              className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-[12px] font-medium transition-all whitespace-nowrap ${
                activeDashboard?.id === d.id
                  ? "bg-primary-container/10 border-primary-container/20 text-primary-m3 shadow-sm"
                  : "bg-white border-outline-variant/15 text-on-surface-variant hover:border-[#c8c5cb] hover:bg-surface"
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {categoryIcon[d.category] || "dashboard"}
              </span>
              {d.title}
            </button>
          ))}
        </div>
      </div>

      {isExpanded && (
        <div className="px-5 pb-4">
          {activeDashboard && (
            <div className="mb-3 flex items-center gap-3">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-2xl border text-[10px] font-medium tracking-wider ${categoryColor[activeDashboard.category] || "bg-surface text-on-surface-variant border-outline-variant/15"}`}>
                {activeDashboard.category.toUpperCase()}
              </span>
              <p className="text-[12px] text-on-surface-variant">{activeDashboard.description}</p>
            </div>
          )}

          {loading && (
            <div className="h-80 rounded-2xl bg-surface border ghost-border flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary-container/20 border-t-primary-container rounded-full animate-spin" />
                <p className="text-[12px] text-on-surface-variant">Authenticating Looker session…</p>
              </div>
            </div>
          )}

          {error && (
            <div className="h-80 rounded-2xl bg-amber-50/50 border border-amber-200 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 max-w-xs text-center">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 22 }}>
                    warning
                  </span>
                </div>
                <p className="text-[12px] text-amber-700 font-medium">Looker Connection Required</p>
                <p className="text-[11px] text-amber-600/70">{error}</p>
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Add <code className="bg-surface-container-low px-1 py-0.5 rounded text-[9px]">LOOKER_HOST</code>,{" "}
                  <code className="bg-surface-container-low px-1 py-0.5 rounded text-[9px]">LOOKER_API_CLIENT_ID</code>, and{" "}
                  <code className="bg-surface-container-low px-1 py-0.5 rounded text-[9px]">LOOKER_API_CLIENT_SECRET</code> to connect.
                </p>
              </div>
            </div>
          )}

          {!loading && !error && embedSession && (
            <div className="relative rounded-2xl overflow-hidden border ghost-border bg-white">
              <div className="absolute top-2 right-2 z-10 flex gap-1.5">
                {embedSession.features.sharing && (
                  <button disabled title="Coming soon" className="w-7 h-7 rounded-2xl bg-white/90 backdrop-blur-sm shadow-sm border border-outline-variant/15 flex items-center justify-center opacity-40 cursor-not-allowed">
                    <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 14 }}>share</span>
                  </button>
                )}
                {embedSession.features.downloading && (
                  <button disabled title="Coming soon" className="w-7 h-7 rounded-2xl bg-white/90 backdrop-blur-sm shadow-sm border border-outline-variant/15 flex items-center justify-center opacity-40 cursor-not-allowed">
                    <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 14 }}>download</span>
                  </button>
                )}
              </div>
              <div ref={embedContainerRef} className="w-full" style={{ minHeight: 480 }} />
              {!sdkEmbedActive && (
                <iframe
                  src={embedSession.embedUrl}
                  className="w-full border-0"
                  style={{ height: 480 }}
                  title={`Looker — ${activeDashboard?.title || "Dashboard"}`}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              )}
            </div>
          )}

          {!loading && !error && !embedSession && (
            <div className="h-80 rounded-2xl bg-surface border ghost-border flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 max-w-xs text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary-container/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#60a5fa]" style={{ fontSize: 28 }}>
                    analytics
                  </span>
                </div>
                <p className="text-[13px] text-on-surface-variant font-medium">Select a Dashboard</p>
                <p className="text-[11px] text-on-surface-variant">
                  Choose a dashboard above to embed a live Looker visualization with full interactivity.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {!isExpanded && (
        <div className="px-5 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {dashboards.map((d) => (
              <button
                key={d.id}
                onClick={() => { setActiveDashboard(d); setIsExpanded(true); loadEmbed(d); }}
                className="flex flex-col gap-1.5 p-3 rounded-2xl border ghost-border hover:border-outline-variant/15 hover:bg-surface/50 transition-all text-left group"
              >
                <div className={`w-7 h-7 rounded-2xl flex items-center justify-center ${categoryColor[d.category]?.split(" ")[0] || "bg-surface"}`}>
                  <span className={`material-symbols-outlined ${categoryColor[d.category]?.split(" ")[1] || "text-on-surface-variant"}`} style={{ fontSize: 15 }}>
                    {categoryIcon[d.category] || "dashboard"}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-on-surface group-hover:text-primary-container transition-colors">{d.title}</p>
                <p className="text-[10px] text-on-surface-variant line-clamp-2">{d.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
