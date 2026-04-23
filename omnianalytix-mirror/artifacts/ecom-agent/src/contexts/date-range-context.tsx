import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DatePreset = "today" | "7d" | "14d" | "30d" | "90d" | "mtd" | "ytd" | "custom";

export interface DateRange {
  preset: DatePreset;
  label: string;
  daysBack: number;
  from: Date;
  to: Date;
}

interface DateRangeContextValue {
  dateRange: DateRange;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: Date, to: Date) => void;
  refreshKey: number;
}

const PRESETS: Record<Exclude<DatePreset, "custom" | "mtd" | "ytd">, { label: string; daysBack: number }> = {
  today:  { label: "Today",     daysBack: 1 },
  "7d":   { label: "Last 7 Days",  daysBack: 7 },
  "14d":  { label: "Last 14 Days", daysBack: 14 },
  "30d":  { label: "Last 30 Days", daysBack: 30 },
  "90d":  { label: "Last 90 Days", daysBack: 90 },
};

function buildDynamicPreset(preset: "mtd" | "ytd"): { label: string; daysBack: number; from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from: Date;
  if (preset === "mtd") {
    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else {
    from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
  const diff = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  const label = preset === "mtd" ? "Month to Date" : "Year to Date";
  return { label, daysBack: diff, from, to };
}

function buildRange(preset: DatePreset, customFrom?: Date, customTo?: Date): DateRange {
  if (preset === "custom" && customFrom && customTo) {
    const diff = Math.ceil((customTo.getTime() - customFrom.getTime()) / 86_400_000);
    const fromStr = customFrom.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const toStr = customTo.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { preset, label: `${fromStr} – ${toStr}`, daysBack: diff, from: customFrom, to: customTo };
  }
  if (preset === "mtd" || preset === "ytd") {
    const dynamic = buildDynamicPreset(preset);
    return { preset, ...dynamic };
  }
  const meta = PRESETS[preset as Exclude<DatePreset, "custom" | "mtd" | "ytd">] ?? PRESETS["30d"];
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - meta.daysBack);
  from.setHours(0, 0, 0, 0);
  return { preset, label: meta.label, daysBack: meta.daysBack, from, to };
}

const DEFAULT_PRESET: DatePreset = "30d";

const DateRangeContext = createContext<DateRangeContextValue>({
  dateRange: buildRange(DEFAULT_PRESET),
  setPreset: () => {},
  setCustomRange: () => {},
  refreshKey: 0,
});

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [customFrom, setCustomFrom] = useState<Date | undefined>(() => {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem("omni_date_custom_from");
      if (v) { const d = new Date(v); if (!isNaN(d.getTime())) return d; }
    }
    return undefined;
  });
  const [customTo, setCustomTo] = useState<Date | undefined>(() => {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem("omni_date_custom_to");
      if (v) { const d = new Date(v); if (!isNaN(d.getTime())) return d; }
    }
    return undefined;
  });

  const [preset, setPresetState] = useState<DatePreset>(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("omni_date_preset");
      if (stored === "custom" && customFrom && customTo) return "custom";
      if (stored === "mtd" || stored === "ytd") return stored;
      if (stored && stored in PRESETS) return stored as Exclude<DatePreset, "custom" | "mtd" | "ytd">;
    }
    return DEFAULT_PRESET;
  });

  const [refreshKey, setRefreshKey] = useState(0);

  const dateRange = buildRange(preset, customFrom, customTo);

  const setPreset = useCallback((p: DatePreset) => {
    setPresetState(p);
    setRefreshKey((k) => k + 1);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("omni_date_preset", p);
    }
  }, []);

  const setCustomRange = useCallback((from: Date, to: Date) => {
    setCustomFrom(from);
    setCustomTo(to);
    setPresetState("custom");
    setRefreshKey((k) => k + 1);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("omni_date_preset", "custom");
      localStorage.setItem("omni_date_custom_from", from.toISOString());
      localStorage.setItem("omni_date_custom_to", to.toISOString());
    }
  }, []);

  return (
    <DateRangeContext.Provider value={{ dateRange, setPreset, setCustomRange, refreshKey }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}

export { PRESETS };
