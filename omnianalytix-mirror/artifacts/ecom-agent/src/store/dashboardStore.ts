import { create } from "zustand";
import { z } from "zod";
import { authFetch } from "@/lib/auth-fetch";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export const TenantSyncState = {
  AWAITING_OAUTH:        "AWAITING_OAUTH",
  HISTORICAL_BACKFILL:   "HISTORICAL_BACKFILL",
  SYNCING:               "SYNCING",
  OPERATIONAL_EMPTY:     "OPERATIONAL_EMPTY",
  OPERATIONAL_POPULATED: "OPERATIONAL_POPULATED",
  STALE_DATA:            "STALE_DATA",
} as const;
export type TenantSyncState = typeof TenantSyncState[keyof typeof TenantSyncState];

export const GoalType = {
  ECOMMERCE: "E-COMMERCE",
  LEADGEN:   "LEADGEN",
  HYBRID:    "HYBRID",
} as const;
export type GoalType = typeof GoalType[keyof typeof GoalType];

const TenantSyncStateEnum = z.enum([
  "AWAITING_OAUTH","HISTORICAL_BACKFILL","SYNCING","OPERATIONAL_EMPTY","OPERATIONAL_POPULATED","STALE_DATA",
]);
const GoalTypeEnum = z.enum(["E-COMMERCE","LEADGEN","HYBRID"]);

export const MarginLeakRowSchema = z.object({
  sku: z.string(),
  productTitle: z.string(),
  productId: z.string(),
  spendUsd: z.number(),
  attributedRevenueUsd: z.number(),
  attributedProfitUsd: z.number(),
  marginPct: z.number(),
  severity: z.enum(["critical", "warning", "info"]),
});
export type MarginLeakRow = z.infer<typeof MarginLeakRowSchema>;

export const CrmSyncIssueSchema = z.object({
  leadId: z.string(),
  email: z.string(),
  reason: z.string(),
  pipelineStage: z.string(),
  dealAmount: z.number(),
});
export type CrmSyncIssue = z.infer<typeof CrmSyncIssueSchema>;

export const UnifiedDashboardStateSchema = z.object({
  syncState: TenantSyncStateEnum,
  goalType: GoalTypeEnum,
  lastSyncedAt: z.number().nullable(),
  workspaceId: z.number().nullable(),
  workspaceName: z.string().nullable(),
  ecommerce: z.object({
    spendUsd: z.number(),
    revenueUsd: z.number(),
    cogsUsd: z.number(),
    trueProfitUsd: z.number(),
    poas: z.number(),
    conversions: z.number(),
    marginLeaks: z.array(MarginLeakRowSchema),
  }).nullable(),
  leadgen: z.object({
    spendUsd: z.number(),
    leadCount: z.number(),
    qualifiedLeadCount: z.number(),
    pipelineValueUsd: z.number(),
    closedWonValueUsd: z.number(),
    cplUsd: z.number(),
    crmSyncIssues: z.array(CrmSyncIssueSchema),
  }).nullable(),
  meta: z.object({
    computedAtMs: z.number(),
    etlPhase: z.string(),
    etlPct: z.number(),
    isStale: z.boolean(),
  }),
});
export type UnifiedDashboardState = z.infer<typeof UnifiedDashboardStateSchema>;

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

interface DashboardStore {
  syncState: TenantSyncState;
  goalType: GoalType;
  lastSyncedAt: number | null;
  workspaceId: number | null;
  workspaceName: string | null;
  ecommerce: UnifiedDashboardState["ecommerce"];
  leadgen: UnifiedDashboardState["leadgen"];
  meta: UnifiedDashboardState["meta"];
  isLoading: boolean;
  error: string | null;
  hasLoadedOnce: boolean;
  _requestSeq: number;
  /**
   * Set by ecommerce-dashboard / hybrid-dashboard after they fetch
   * /api/warehouse/margin-leaks. True when the warehouse has margin-leak
   * rows outside the currently selected date window (so the widget can
   * show WindowEmptyBanner instead of "all clear").
   */
  leaksWindowEmpty: boolean;
  leaksLatestAdsSyncAt: string | null;
  setLeaksWindowMeta: (windowEmpty: boolean, latestAdsSyncAt: string | null) => void;
  isStale: () => boolean;
  /**
   * True when warehouse data is meaningfully populated for THIS tenant —
   * either OPERATIONAL_POPULATED (fresh) or STALE_DATA (old but real).
   *
   * Returns false for AWAITING_OAUTH, OPERATIONAL_EMPTY, SYNCING, and
   * HISTORICAL_BACKFILL — in which cases widgets must show an
   * "insufficient data" / "syncing" empty state rather than rendering
   * derived KPIs (e.g. POAS = -1.00x because spend > 0 but revenue = 0)
   * or "all clear" messages (e.g. "no margin leaks detected" when the
   * leak detector simply has no rows to scan). Use this in every widget
   * that derives meaning from warehouse state.
   */
  hasUsableData: () => boolean;
  fetchUnifiedState: (workspaceId: number | null) => Promise<void>;
  reset: () => void;
}

const INITIAL_META: UnifiedDashboardState["meta"] = {
  computedAtMs: 0,
  etlPhase: "idle",
  etlPct: 0,
  isStale: false,
};

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  syncState: "AWAITING_OAUTH",
  goalType: "E-COMMERCE",
  lastSyncedAt: null,
  workspaceId: null,
  workspaceName: null,
  ecommerce: null,
  leadgen: null,
  meta: INITIAL_META,
  isLoading: false,
  error: null,
  hasLoadedOnce: false,
  _requestSeq: 0,
  leaksWindowEmpty: false,
  leaksLatestAdsSyncAt: null,
  setLeaksWindowMeta: (windowEmpty, latestAdsSyncAt) =>
    set({ leaksWindowEmpty: windowEmpty, leaksLatestAdsSyncAt: latestAdsSyncAt }),

  isStale: () => {
    const ls = get().lastSyncedAt;
    if (ls == null) return false;
    return Date.now() - ls > STALE_THRESHOLD_MS;
  },

  hasUsableData: () => {
    const { syncState: s, lastSyncedAt } = get();
    if (s === "OPERATIONAL_POPULATED" || s === "STALE_DATA") return true;
    // Mid-sync regression fix (architect, Apr 2026): when ETL is actively
    // running on a tenant that already has populated rows, deriveSyncState()
    // collapses to SYNCING / HISTORICAL_BACKFILL on the server before the
    // row-count checks. If we treated those as "no data", every KPI tile
    // would briefly flicker to "—" during every sync cycle even though the
    // user already has real measurements on disk. We keep showing prior
    // values whenever lastSyncedAt is non-null; the existing isStale() /
    // global-status banners surface the in-progress sync separately.
    if ((s === "SYNCING" || s === "HISTORICAL_BACKFILL") && lastSyncedAt != null) {
      return true;
    }
    return false;
  },

  fetchUnifiedState: async (workspaceId: number | null) => {
    const mySeq = get()._requestSeq + 1;
    set({ isLoading: true, error: null, _requestSeq: mySeq });
    try {
      const res = await authFetch(`${BASE}/api/dashboard/unified-state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceId ?? undefined }),
      });
      if (get()._requestSeq !== mySeq) return; // stale response — newer fetch in flight
      if (!res.ok) throw new Error(`Dashboard fetch failed: ${res.status}`);
      const json = await res.json();
      const parsed = UnifiedDashboardStateSchema.safeParse(json);
      if (!parsed.success) {
        console.error("[dashboardStore] BFF response failed Zod validation", parsed.error.issues);
        throw new Error("Server returned a malformed dashboard payload");
      }
      if (get()._requestSeq !== mySeq) return; // stale response after parse
      const d = parsed.data;
      set({
        syncState:     d.syncState,
        goalType:      d.goalType,
        lastSyncedAt:  d.lastSyncedAt,
        workspaceId:   d.workspaceId,
        workspaceName: d.workspaceName,
        ecommerce:     d.ecommerce,
        leadgen:       d.leadgen,
        meta:          d.meta,
        isLoading:     false,
        hasLoadedOnce: true,
        error:         null,
      });
    } catch (err) {
      if (get()._requestSeq !== mySeq) return;
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  reset: () => set({
    syncState: "AWAITING_OAUTH",
    goalType: "E-COMMERCE",
    lastSyncedAt: null,
    workspaceId: null,
    workspaceName: null,
    ecommerce: null,
    leadgen: null,
    meta: INITIAL_META,
    isLoading: false,
    error: null,
    hasLoadedOnce: false,
    leaksWindowEmpty: false,
    leaksLatestAdsSyncAt: null,
  }),
}));
