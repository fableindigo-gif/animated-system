import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

export interface DashboardFilter {
  skuId: string | null;
  campaignId: string | null;
}

interface DashboardFilterContextValue extends DashboardFilter {
  setFilter: (next: Partial<DashboardFilter>) => void;
  clearFilter: () => void;
  isFiltered: boolean;
}

const DashboardFilterContext = createContext<DashboardFilterContextValue>({
  skuId: null,
  campaignId: null,
  setFilter: () => {},
  clearFilter: () => {},
  isFiltered: false,
});

export function DashboardFilterProvider({ children }: { children: ReactNode }) {
  const [skuId, setSkuId]             = useState<string | null>(null);
  const [campaignId, setCampaignId]   = useState<string | null>(null);

  const setFilter = useCallback((next: Partial<DashboardFilter>) => {
    if ("skuId" in next)      setSkuId(next.skuId ?? null);
    if ("campaignId" in next) setCampaignId(next.campaignId ?? null);
  }, []);

  const clearFilter = useCallback(() => {
    setSkuId(null);
    setCampaignId(null);
  }, []);

  const value = useMemo<DashboardFilterContextValue>(() => ({
    skuId,
    campaignId,
    setFilter,
    clearFilter,
    isFiltered: skuId != null || campaignId != null,
  }), [skuId, campaignId, setFilter, clearFilter]);

  return (
    <DashboardFilterContext.Provider value={value}>
      {children}
    </DashboardFilterContext.Provider>
  );
}

export function useDashboardFilter() {
  return useContext(DashboardFilterContext);
}
