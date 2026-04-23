import { useFilters, filtersToQueryString } from "@/contexts/filters-context";

/**
 * Returns the active filter query-string fragment (`&filter.foo=...`) plus
 * a refresh-key suitable for `useEffect` dependency arrays. When no filters
 * are set, qs is `""` so it's safe to concatenate unconditionally.
 */
export function useFilterQs(pageKey: string) {
  const { filters, refreshKey } = useFilters(pageKey);
  return { qs: filtersToQueryString(filters), refreshKey, filters };
}
