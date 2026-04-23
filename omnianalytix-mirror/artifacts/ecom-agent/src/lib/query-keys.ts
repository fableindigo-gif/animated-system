/**
 * Centralized react-query key factory.
 *
 * Convention:
 *   queryKeys.<resource>(...args)
 *
 * Always call through this object — never inline `["foo", id]` at a callsite.
 * That guarantees mutations can invalidate the exact key shape that queries
 * subscribe to.
 *
 * For mutations, prefer:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.<resource>() })
 * over manual refetch helpers.
 *
 * For pages that previously used `useEffect + useState + authFetch`, the
 * migration target is `useQuery({ queryKey, queryFn })`. That fixes three
 * audit findings at once:
 *   1) AbortController-style cancellation (react-query cancels in-flight
 *      requests when the component unmounts or the key changes).
 *   2) No more silent `catch {}`: throw inside queryFn and render
 *      `<QueryErrorState>` from the `error` / `isError` flags.
 *   3) Cache de-dup: visiting the same key twice in quick succession is
 *      served from cache instead of re-hitting the network.
 */
export const queryKeys = {
  adminOrganizations: () => ["admin", "organizations"] as const,
  agencyOrganizations: () => ["agency", "organizations"] as const,
  aiAgents: () => ["ai-agents"] as const,
  auditLog: (page: number, pageSize: number) => ["audit-log", page, pageSize] as const,
  auditLogEntry: (id: number) => ["audit-log", "entry", id] as const,
  dataModelingMetrics: () => ["data-modeling", "metrics"] as const,
  economicsSettings: () => ["settings", "economics"] as const,
  aiQuotaSettings: () => ["settings", "ai-quota"] as const,
  feedEnrichmentStatus: () => ["feed-enrichment", "status"] as const,
  feedEnrichmentProducts: (page: number, filter: string) => ["feed-enrichment", "products", page, filter] as const,
  forensicEcom: (days: number) => ["forensic", "ecom", days] as const,
  forensicLeadgen: (days: number) => ["forensic", "leadgen", days] as const,
  tasks: (status: string) => ["tasks", status] as const,
  tasksAll: () => ["tasks"] as const,
} as const;
