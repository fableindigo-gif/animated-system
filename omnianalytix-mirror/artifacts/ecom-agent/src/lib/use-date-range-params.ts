import { useMemo } from "react";
import { useDateRange } from "@/contexts/date-range-context";

export interface DateRangeParams {
  from: string;
  to: string;
  daysBack: number;
  refreshKey: number;
  qs: string;
}

/**
 * Standard helper that turns the global DateRangeContext into the params
 * every API endpoint in this project expects:
 *   - `from`, `to`        ISO YYYY-MM-DD strings
 *   - `daysBack`          integer days between from/to (>=1)
 *   - `refreshKey`        opaque counter that changes on manual Refresh /
 *                         preset switch — include this in React effect deps
 *                         and React Query cache keys to force re-fetch.
 *   - `qs`                preformatted "?from=…&to=…&days=…" suffix
 *
 * Usage:
 *   const { from, to, daysBack, refreshKey, qs } = useDateRangeParams();
 *   useEffect(() => { fetch(`/api/x${qs}`); }, [refreshKey, from, to]);
 */
export function useDateRangeParams(): DateRangeParams {
  const { dateRange, refreshKey } = useDateRange();
  return useMemo(() => {
    const from = dateRange.from.toISOString().slice(0, 10);
    const to = dateRange.to.toISOString().slice(0, 10);
    const daysBack = Math.max(1, dateRange.daysBack);
    const qs = `?from=${from}&to=${to}&days=${daysBack}&days_back=${daysBack}`;
    return { from, to, daysBack, refreshKey, qs };
  }, [dateRange.from, dateRange.to, dateRange.daysBack, refreshKey]);
}
