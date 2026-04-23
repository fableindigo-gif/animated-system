/**
 * Tenant ownership guards — Phase 2 of the reliability program.
 *
 * The system has 3 tenant axes (`organizationId`, `tenantId`, `workspaceId`)
 * across ~30 tables, so a Drizzle-level enforced filter is impractical.
 * Instead we use TWO complementary mechanisms:
 *
 *   • `middleware/tenant-isolation.ts` — ROUTE-LEVEL middleware for the
 *     simple "the id in the URL is your org/workspace" case. Wired with
 *     `router.get("/:id/...", requireSameOrg("id"), handler)`. Use this
 *     whenever the path itself names the tenant resource.
 *
 *   • THIS FILE (`lib/tenant-guards.ts`) — IN-HANDLER assertion helpers
 *     for the "child resource keyed by a parent id" case (e.g. `kbChunks`
 *     keyed by `agentId`, where only the parent `aiAgents` row carries
 *     `organizationId`). Call these BEFORE the first DB read/mutate on
 *     the child table.
 *
 * Both mechanisms throw 404 (never 403) on tenant-mismatch so we don't
 * reveal whether the resource exists in some other tenant.
 *
 * Pattern:
 *   const orgId = requireOrgId(req);                  // 401 if missing
 *   await assertOwnsAgent(orgId, agentId);            // 404 if not owner
 *   await db.delete(kbChunks).where(...);             // safe to mutate
 *
 * The lint guard `scripts/check-tenant-ownership.mjs` enforces that any
 * `db.delete/.update/.select.from(<child-table>)` is preceded in the same
 * handler by one of these helpers (or the middleware equivalent).
 */
import { and, eq } from "drizzle-orm";
import { db, aiAgents, workspaces, platformConnections } from "@workspace/db";

/**
 * Thrown when the caller's tenant does not own the requested resource.
 * `handleRouteError` converts this to HTTP 404 (NOT 403) by design —
 * leaking the existence of resources across tenants is itself a CVE.
 */
export class TenantOwnershipError extends Error {
  readonly httpStatus = 404 as const;
  readonly code = "RESOURCE_NOT_FOUND" as const;
  constructor(public readonly resource: string, public readonly id: number | string) {
    super(`${resource} not found`);
    this.name = "TenantOwnershipError";
  }
}

/**
 * Assert that the given agent belongs to the caller's organization.
 * Throws TenantOwnershipError (→ 404) if it doesn't exist OR belongs to
 * another org.
 */
export async function assertOwnsAgent(orgId: number, agentId: number): Promise<void> {
  const [row] = await db
    .select({ id: aiAgents.id })
    .from(aiAgents)
    .where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId)))
    .limit(1);
  if (!row) throw new TenantOwnershipError("Agent", agentId);
}

/**
 * Assert that the given workspace belongs to the caller's organization.
 */
export async function assertOwnsWorkspace(orgId: number, workspaceId: number): Promise<void> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, orgId)))
    .limit(1);
  if (!row) throw new TenantOwnershipError("Workspace", workspaceId);
}

/**
 * Assert that the given platform connection belongs to the caller's
 * organization.
 */
export async function assertOwnsConnection(orgId: number, connectionId: number): Promise<void> {
  const [row] = await db
    .select({ id: platformConnections.id })
    .from(platformConnections)
    .where(and(eq(platformConnections.id, connectionId), eq(platformConnections.organizationId, orgId)))
    .limit(1);
  if (!row) throw new TenantOwnershipError("Connection", connectionId);
}
