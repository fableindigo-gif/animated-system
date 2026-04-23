import { CalendarClock } from "lucide-react";
import { useDateRange } from "@/contexts/date-range-context";
import { cn } from "@/lib/utils";

interface WindowEmptyBannerProps {
  latestSyncAt: string | null;
  className?: string;
}

function formatLatestSync(iso: string | null): string {
  if (!iso) return "an earlier date";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "an earlier date";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function WindowEmptyBanner({ latestSyncAt, className }: WindowEmptyBannerProps) {
  const { dateRange, setPreset } = useDateRange();
  const latest = formatLatestSync(latestSyncAt);

  return (
    <div
      role="status"
      data-testid="banner-window-empty"
      className={cn(
        "rounded-2xl border border-amber-300/40 bg-amber-50/70 px-5 py-4",
        "flex flex-wrap items-start gap-3 shadow-sm",
        className,
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <CalendarClock className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-amber-900">
          No data in selected window ({dateRange.label})
        </p>
        <p className="mt-0.5 text-[11px] text-amber-800/80 leading-relaxed">
          Your platforms are connected, but the warehouse has no rows in this date range.
          Latest sync was on <span className="font-semibold">{latest}</span>.
        </p>
      </div>
      {dateRange.preset !== "30d" && (
        <button
          type="button"
          data-testid="button-switch-30d"
          onClick={() => setPreset("30d")}
          className={cn(
            "shrink-0 rounded-2xl border border-amber-400/40 bg-white px-3 py-1.5",
            "text-[11px] font-semibold text-amber-900 hover:bg-amber-100 transition-colors",
          )}
        >
          Switch to Last 30 Days
        </button>
      )}
    </div>
  );
}
