import { useState, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { cn } from "@/lib/utils";
import { Loader2, TrendingUp, TrendingDown, DollarSign, ShoppingCart, BarChart3, Activity, Clock, Shield, AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface SharedKpi {
  label: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  trend?: number;
  icon?: string;
}

interface SharedReportData {
  shareId: string;
  agencyName: string | null;
  reportTitle: string;
  reportData: {
    kpis?: SharedKpi[];
    executiveSummary?: string;
    generatedAt?: string;
    dateRange?: string;
    platforms?: string[];
    alerts?: Array<{ severity: string; title: string; description?: string }>;
  };
  createdAt: string;
  expiresAt: string | null;
}

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) { setValue(target); return; }

    startRef.current = null;
    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, duration]);

  return value;
}

function KpiCard({ kpi, delay }: { kpi: SharedKpi; delay: number }) {
  const numericValue = typeof kpi.value === "number" ? kpi.value : parseFloat(String(kpi.value)) || 0;
  const animated = useCountUp(numericValue);
  const trend = kpi.trend;

  const iconMap: Record<string, React.ReactNode> = {
    spend: <DollarSign className="w-5 h-5" />,
    revenue: <TrendingUp className="w-5 h-5" />,
    conversions: <ShoppingCart className="w-5 h-5" />,
    roas: <BarChart3 className="w-5 h-5" />,
    poas: <Activity className="w-5 h-5" />,
  };

  const icon = kpi.icon ? iconMap[kpi.icon] || <BarChart3 className="w-5 h-5" /> : <BarChart3 className="w-5 h-5" />;

  function formatValue(n: number): string {
    if (kpi.prefix === "$" || kpi.prefix === "₹") {
      if (n >= 1_000_000) return `${kpi.prefix}${(n / 1_000_000).toFixed(2)}M`;
      if (n >= 1_000) return `${kpi.prefix}${(n / 1_000).toFixed(1)}k`;
      return `${kpi.prefix}${n.toFixed(2)}`;
    }
    if (kpi.suffix === "x") return `${n.toFixed(2)}x`;
    if (kpi.suffix === "%") return `${n.toFixed(1)}%`;
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString();
  }

  return (
    <div
      className="bg-white rounded-2xl border ghost-border p-5 shadow-sm hover:shadow-md transition-shadow"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-2xl bg-primary-container/10 flex items-center justify-center text-primary-container">
          {icon}
        </div>
        {trend !== undefined && trend !== null && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-2xl text-[11px] font-semibold",
            trend >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-error-container text-error-m3"
          )}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend >= 0 ? "+" : ""}{trend}%
          </div>
        )}
      </div>
      <p className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wider mb-1">{kpi.label}</p>
      <p className="text-2xl font-bold text-on-surface tabular-nums">
        {formatValue(animated)}
      </p>
    </div>
  );
}

export default function SharedReport() {
  const [, params] = useRoute("/shared/:id");
  const shareId = params?.id;

  const [report, setReport] = useState<SharedReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${BASE}/api/shared-reports/${shareId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Report not found");
        }
        const data = await res.json();
        if (!cancelled) setReport(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [shareId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-primary-container animate-spin" />
          <p className="text-[13px] text-on-surface-variant">Loading report…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="max-w-sm mx-auto text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-error-container flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
          </div>
          <h2 className="text-lg font-semibold text-on-surface mb-2">Report Unavailable</h2>
          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            {error || "This report link may have expired or been deactivated."}
          </p>
        </div>
      </div>
    );
  }

  const { reportData, agencyName, reportTitle, createdAt } = report;
  const kpis = reportData.kpis || [];
  const summary = reportData.executiveSummary || "";
  const dateRange = reportData.dateRange;
  const alerts = reportData.alerts || [];

  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-white border-b ghost-border">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary-container to-primary-container/30 flex items-center justify-center">
              <span className="text-white font-bold text-[14px]">O</span>
            </div>
            <div>
              {agencyName && (
                <p className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wider">{agencyName}</p>
              )}
              <h1 className="text-[15px] font-semibold text-on-surface">{reportTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              Read-Only
            </div>
            <div className="w-px h-4 bg-surface-container-highest" />
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {dateRange && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wider">Period</span>
            <span className="text-[12px] text-on-surface-variant font-medium">{dateRange}</span>
          </div>
        )}

        {kpis.length > 0 && (
          <section>
            <h2 className="text-[11px] text-on-surface-variant font-semibold uppercase tracking-wider mb-4">Key Metrics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {kpis.map((kpi, i) => (
                <KpiCard key={i} kpi={kpi} delay={i * 100} />
              ))}
            </div>
          </section>
        )}

        {summary && (
          <section className="bg-white rounded-2xl border ghost-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b ghost-border flex items-center gap-3">
              <div className="w-8 h-8 rounded-2xl bg-primary-container/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary-container" />
              </div>
              <h2 className="text-[13px] font-semibold text-on-surface">Executive Summary</h2>
            </div>
            <div className="px-6 py-5">
              <div className="prose prose-sm max-w-none text-on-surface-variant leading-relaxed text-[13px]">
                {summary.split("\n").map((line, i) => (
                  <p key={i} className={cn("mb-2", !line.trim() && "mb-4")}>{line}</p>
                ))}
              </div>
            </div>
          </section>
        )}

        {alerts.length > 0 && (
          <section className="bg-white rounded-2xl border ghost-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b ghost-border flex items-center gap-3">
              <div className="w-8 h-8 rounded-2xl bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              </div>
              <h2 className="text-[13px] font-semibold text-on-surface">Active Alerts</h2>
              <span className="ml-auto text-[11px] text-on-surface-variant">{alerts.length} item{alerts.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-[#f9f9fe]">
              {alerts.map((alert, i) => (
                <div key={i} className="px-6 py-3.5 flex items-start gap-3">
                  <div className={cn(
                    "w-2 h-2 rounded-full mt-1.5 shrink-0",
                    alert.severity === "critical" ? "bg-error-container" :
                    alert.severity === "warning" ? "bg-amber-500" : "bg-primary-container"
                  )} />
                  <div>
                    <p className="text-[13px] font-medium text-on-surface">{alert.title}</p>
                    {alert.description && (
                      <p className="text-[12px] text-on-surface-variant mt-0.5">{alert.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t ghost-border bg-white mt-12">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-primary-container to-primary-container/30 flex items-center justify-center">
              <span className="text-white font-bold text-[8px]">O</span>
            </div>
            <span className="text-[11px] text-on-surface-variant">
              Powered by <span className="font-semibold text-on-surface-variant">OmniAnalytix</span>
            </span>
          </div>
          <p className="text-[10px] text-outline-variant">
            This is a read-only report. No data can be modified from this view.
          </p>
        </div>
      </footer>
    </div>
  );
}
