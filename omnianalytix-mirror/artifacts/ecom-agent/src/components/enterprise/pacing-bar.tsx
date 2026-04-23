import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Activity, Loader2 } from "lucide-react";
import { useCurrency } from "@/contexts/currency-context";
import { useDateRange } from "@/contexts/date-range-context";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

const RING_R   = 11;
const RING_C   = 2 * Math.PI * RING_R;   // ≈ 69.1
const RING_SZ  = 30;                      // svg viewBox size

interface PacingMetric {
  label: string;
  current: number;
  target: number;
  prefix?: string;
  suffix?: string;
  invert?: boolean;
}

function pct(current: number, target: number) {
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
}

function formatNum(val: number, prefix = "", suffix = "") {
  if (val >= 1000) return `${prefix}${(val / 1000).toFixed(1)}k${suffix}`;
  if (suffix === "x") return `${prefix}${val.toFixed(2)}${suffix}`;
  return `${prefix}${val.toFixed(0)}${suffix}`;
}

function ringStroke(p: number, invert = false) {
  if (invert) return p > 100 ? "#ef4444" : p > 80 ? "#f59e0b" : "#16a34a";
  if (p >= 90) return "#0081FB";
  if (p >= 70) return "#f59e0b";
  return "#ef4444";
}

function textColor(p: number, invert = false) {
  if (invert) return p > 100 ? "text-error-m3" : p > 80 ? "text-amber-400" : "text-emerald-600";
  if (p >= 90) return "text-accent-blue";
  if (p >= 70) return "text-amber-400";
  return "text-error-m3";
}

function ProgressRing({ p, invert = false }: { p: number; invert?: boolean }) {
  const [animatedP, setAnimatedP] = useState(0);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) { setAnimatedP(p); return; }
    const start = performance.now();
    const dur   = 600;
    const raf = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedP(Math.round(eased * p));
      if (t < 1) requestAnimationFrame(raf);
    };
    const id = requestAnimationFrame(raf);
    return () => cancelAnimationFrame(id);
  }, [p]);

  const stroke   = ringStroke(p, invert);
  const dashoffset = RING_C * (1 - animatedP / 100);

  return (
    <svg
      width={RING_SZ}
      height={RING_SZ}
      viewBox={`0 0 ${RING_SZ} ${RING_SZ}`}
      className="shrink-0"
      style={{ transform: "rotate(-90deg)" }}
    >
      <circle
        cx={RING_SZ / 2}
        cy={RING_SZ / 2}
        r={RING_R}
        fill="none"
        stroke="rgba(0,0,0,0.07)"
        strokeWidth={3}
      />
      <circle
        cx={RING_SZ / 2}
        cy={RING_SZ / 2}
        r={RING_R}
        fill="none"
        stroke={stroke}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={dashoffset}
        style={{ transition: "stroke-dashoffset 0.05s linear", willChange: "stroke-dashoffset" }}
      />
    </svg>
  );
}

interface PacingBarProps {
  className?: string;
}

export function PacingBar({ className }: PacingBarProps) {
  const { currencySymbol } = useCurrency();
  const { dateRange } = useDateRange();
  const [metrics, setMetrics] = useState<PacingMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [overallPacing, setOverallPacing] = useState(0);
  const [marginSaved, setMarginSaved] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`${API_BASE}api/warehouse/kpis?days=${dateRange.daysBack}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error("kpi fetch failed");
        const data = await res.json();
        if (controller.signal.aborted) return;

        const budgetTarget = parseFloat(localStorage.getItem("omni_monthly_budget_target") || "0");
        const dailyBudget = budgetTarget > 0 ? budgetTarget / 30 : 0;
        const dailyRevTarget = dailyBudget > 0 ? dailyBudget * 3 : 0;

        const totalSpend = data.totalSpend ?? 0;
        const estimatedRevenue = data.estimatedRevenue ?? 0;
        const roas = totalSpend > 0 ? estimatedRevenue / totalSpend : 0;
        const poas = data.poas ?? roas;

        const built: PacingMetric[] = [
          { label: "Daily Spend", current: totalSpend / 30, target: dailyBudget || totalSpend / 30, prefix: "SYM" },
          { label: "Blended POAS", current: poas, target: 2.0, suffix: "x", invert: false },
          { label: "Est. Revenue", current: estimatedRevenue / 30, target: dailyRevTarget || estimatedRevenue / 30, prefix: "SYM" },
          { label: "Blended ROAS", current: roas, target: 3.0, suffix: "x" },
        ];

        setMetrics(built);
        const avgPacing = built.reduce((sum, m) => sum + pct(m.current, m.target), 0) / built.length;
        setOverallPacing(Math.round(avgPacing));
        setMarginSaved(data.marginSaved ?? 0);
      } catch {
        if (controller.signal.aborted) return;
        setMetrics([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => { abortRef.current?.abort(); };
  }, [dateRange.daysBack]);

  const displayMetrics = metrics.map((m) => ({
    ...m,
    prefix: m.prefix === "SYM" ? currencySymbol : m.prefix,
  }));

  if (loading) {
    return (
      <div className={cn("w-full border-b border-outline-variant/15 bg-white/70 backdrop-blur-sm px-3 py-1.5 shrink-0 flex items-center justify-center gap-2", className)}>
        <Loader2 className="w-3 h-3 animate-spin text-accent-blue" />
        <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Loading pacing data…</span>
      </div>
    );
  }

  if (displayMetrics.length === 0) return null;

  return (
    <div className={cn(
      "w-full border-b border-outline-variant/15 bg-white/70 backdrop-blur-sm px-3 py-1 shrink-0",
      className,
    )}>
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-1.5 shrink-0 mr-2">
          <Activity className="w-3 h-3 text-accent-blue" />
          <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Portfolio Pacing</span>
        </div>

        <div className="w-px h-4 bg-outline/60 shrink-0 mr-2" />

        {displayMetrics.map((m) => {
          const p   = pct(m.current, m.target);
          const txt = textColor(p, m.invert);
          const isUp = m.current >= m.target;
          const TrendIcon = isUp ? TrendingUp : TrendingDown;

          return (
            <div
              key={m.label}
              className="flex items-center gap-2 shrink-0 px-2.5 border-r border-outline-variant/20 last:border-0 py-0.5"
              style={{ transition: "opacity 0.2s ease" }}
            >
              <ProgressRing p={p} invert={m.invert} />
              <div>
                <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider leading-none mb-0.5">{m.label}</p>
                <div className="flex items-center gap-1">
                  <span className={cn("text-[10px] font-mono font-bold tabular-nums", txt)}>
                    {formatNum(m.current, m.prefix, m.suffix)}
                  </span>
                  <span className="text-[9px] font-mono text-on-surface-variant tabular-nums">/ {formatNum(m.target, m.prefix, m.suffix)}</span>
                  <TrendIcon className={cn("w-2.5 h-2.5 shrink-0", txt)} />
                </div>
              </div>
            </div>
          );
        })}

        <div className="flex items-center gap-2 shrink-0 px-3 mx-1 border-l border-emerald-200 bg-[#16a34a]/5 py-0.5">
          <div>
            <p className="text-[9px] font-mono text-emerald-600/60 uppercase tracking-wider leading-none mb-0.5">Margin Saved ({dateRange.preset === "custom" ? dateRange.label : dateRange.label.replace("Last ", "")})</p>
            <span className="text-[11px] font-mono font-bold text-emerald-600 tabular-nums">{currencySymbol}{marginSaved >= 1000 ? `${(marginSaved / 1000).toFixed(1)}k` : marginSaved.toFixed(2)}</span>
          </div>
        </div>

        <div className="ml-auto shrink-0 pl-2">
          <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded tabular-nums">
            {overallPacing}% Pacing
          </span>
        </div>
      </div>
    </div>
  );
}
