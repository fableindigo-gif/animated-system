import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BriefKpi {
  label: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
}

interface ResolvedItem {
  id: number;
  toolDisplayName: string;
  platformLabel: string;
  resolvedByName: string;
  resolvedAt: string;
}

interface BriefData {
  generatedAt: string;
  dateRange: string;
  kpis: BriefKpi[];
  resolvedTasks: ResolvedItem[];
  executiveSummary: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ExecutiveBrief() {
  const { activeWorkspace } = useWorkspace();
  const { currencySymbol: sym } = useCurrency();
  const { dateRange, refreshKey } = useDateRange();
  const resolvedGoal = useMemo(() => {
    const raw = activeWorkspace?.primaryGoal;
    if (raw === "leadgen" || raw === "hybrid") return raw;
    return "ecom";
  }, [activeWorkspace?.primaryGoal]);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      setLoading(true);

      const fromIso = dateRange.from.toISOString().slice(0, 10);
      const toIso   = dateRange.to.toISOString().slice(0, 10);

      try {
        const [tasksRes, kpiRes] = await Promise.all([
          authFetch(`${BASE}/api/tasks?status=approved&from=${fromIso}&to=${toIso}`),
          authFetch(`${BASE}/api/warehouse/kpis?from=${fromIso}&to=${toIso}`),
        ]);

        const resolvedTasks: ResolvedItem[] = [];
        if (tasksRes.ok) {
          const tasks = await tasksRes.json();
          for (const t of (tasks || []).slice(0, 10)) {
            resolvedTasks.push({
              id: t.id,
              toolDisplayName: t.toolDisplayName,
              platformLabel: t.platformLabel,
              resolvedByName: t.resolvedByName || "System",
              resolvedAt: t.resolvedAt || t.createdAt,
            });
          }
        }

        let kpis: BriefKpi[] = [];
        let executiveSummary = "";
        if (kpiRes.ok) {
          const kpiData = await kpiRes.json();
          const fmtCur = (n: number) => `${sym}${n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(0)}`;
          kpis = [
            { label: "Total Revenue", value: kpiData.estimatedRevenue ? fmtCur(kpiData.estimatedRevenue) : "No data" },
            { label: "Ad Spend", value: kpiData.totalSpend ? fmtCur(kpiData.totalSpend) : "No data" },
            { label: "ROAS", value: kpiData.roas ? `${kpiData.roas.toFixed(2)}×` : "No data" },
            { label: "Active SKUs", value: kpiData.activeSkus ? `${kpiData.activeSkus}` : "0" },
          ];
          if (kpiData.totalSpend && kpiData.estimatedRevenue) {
            const roas = kpiData.estimatedRevenue / kpiData.totalSpend;
            executiveSummary = `We achieved ${fmtCur(kpiData.estimatedRevenue)} in revenue this period against ${fmtCur(kpiData.totalSpend)} in ad spend, delivering a blended ROAS of ${roas.toFixed(2)}×. ${resolvedTasks.length > 0 ? `We identified and deployed ${resolvedTasks.length} optimization insight${resolvedTasks.length > 1 ? "s" : ""} to maintain this trajectory.` : "We have no pending optimization actions — all channels are performing within target thresholds."}`;
          } else {
            executiveSummary = "We are currently completing your platform data sync. A full performance brief will be ready once all connected channels have reported in.";
          }
        } else {
          executiveSummary = "Connect your ad platforms to generate a full performance brief.";
        }

        if (!cancelled) {
          setBrief({
            generatedAt: new Date().toISOString(),
            dateRange: `${formatDate(dateRange.from.toISOString())} — ${formatDate(dateRange.to.toISOString())} (${dateRange.label})`,
            kpis,
            resolvedTasks,
            executiveSummary,
          });
        }
      } catch {
        if (!cancelled) {
          setBrief({
            generatedAt: new Date().toISOString(),
            dateRange: dateRange.label,
            kpis: [],
            resolvedTasks: [],
            executiveSummary: "Unable to generate brief. Please try again.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    generate();
    return () => { cancelled = true; };
  }, [activeWorkspace, sym, resolvedGoal, dateRange.from.getTime(), dateRange.to.getTime(), dateRange.label, refreshKey]);

  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-surface text-on-surface print:bg-white">
      <div className="max-w-3xl mx-auto p-6 sm:p-12">

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-32 gap-4"
            >
              <Loader2 className="w-8 h-8 animate-spin text-outline-variant" />
              <p className="text-sm text-on-surface-variant">Generating Client Brief…</p>
            </motion.div>
          ) : brief ? (
            <motion.div
              key="brief"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="flex items-start justify-between mb-10 print:mb-6">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-1">
                    Client Performance Brief
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter text-on-surface leading-tight">
                    Weekly Summary
                  </h1>
                  <p className="text-xs text-on-surface-variant mt-1">{brief.dateRange}</p>
                </div>
                <div className="flex items-center gap-2 print:hidden">
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-primary-container text-white text-xs font-semibold hover:bg-primary-m3 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-[16px]">print</span>
                    Print / PDF
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border ghost-border shadow-sm p-6 mb-6">
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">Executive Summary</p>
                <p className="text-sm text-on-surface-variant leading-relaxed">{brief.executiveSummary}</p>
              </div>

              {brief.kpis.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {brief.kpis.map((kpi) => (
                    <div key={kpi.label} className="bg-white rounded-2xl border ghost-border shadow-sm p-4">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant mb-1">{kpi.label}</p>
                      <p className="text-xl font-bold tracking-tight text-on-surface">{kpi.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {brief.resolvedTasks.length > 0 && (
                <div className="bg-white rounded-2xl border ghost-border shadow-sm p-6 mb-6">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-4">Optimizations Deployed</p>
                  <div className="space-y-3">
                    {brief.resolvedTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-3 py-2 border-b border-[#f9f9fe] last:border-0">
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">{task.toolDisplayName}</p>
                          <p className="text-[10px] text-on-surface-variant">{task.platformLabel} · by {task.resolvedByName}</p>
                        </div>
                        <span className="text-[10px] text-on-surface-variant shrink-0">{formatDate(task.resolvedAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-center pt-6 border-t ghost-border print:mt-8">
                <p className="text-[10px] text-outline-variant">
                  Generated by OmniAnalytix · {formatDate(brief.generatedAt)}
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
