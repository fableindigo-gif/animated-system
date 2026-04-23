/**
 * rbac-utils.ts — Pure RBAC business logic, no browser/React dependencies.
 * Importable from both frontend contexts and vitest unit tests.
 */

export type AppRole =
  | "super_admin"
  | "admin"
  | "agency_owner"
  | "manager"
  | "analyst"
  | "it"
  | "viewer"
  | "member";

export type ImpactLevel = "LOW" | "MEDIUM" | "HIGH";

export type WorkspaceGoal = "ecom" | "leadgen" | "hybrid";

// ─── Role ranks (higher = more privileged) ────────────────────────────────────

export const ROLE_RANK: Record<AppRole, number> = {
  super_admin:  5,
  agency_owner: 4,
  admin:        4,
  manager:      3,
  analyst:      2,
  it:           2,
  viewer:       1,
  member:       1,
};

// ─── ADMIN_ROLES ──────────────────────────────────────────────────────────────

export const ADMIN_ROLES: AppRole[] = ["super_admin", "admin", "agency_owner"];

// ─── Impact levels require at least this role ─────────────────────────────────

export const REQUIRED_ROLE_FOR_IMPACT: Record<ImpactLevel, AppRole> = {
  LOW:    "analyst",
  MEDIUM: "manager",
  HIGH:   "admin",
};

// ─── Core checks ──────────────────────────────────────────────────────────────

/**
 * Returns true when the user's role meets or exceeds the required role rank.
 */
export function hasPermission(userRole: AppRole, requiredRole: AppRole): boolean {
  const userRank     = ROLE_RANK[userRole]     ?? 0;
  const requiredRank = ROLE_RANK[requiredRole] ?? 0;
  return userRank >= requiredRank;
}

/**
 * Returns true when the user can approve/execute an action at the given impact level.
 */
export function canApproveImpact(userRole: AppRole, level: ImpactLevel): boolean {
  return hasPermission(userRole, REQUIRED_ROLE_FOR_IMPACT[level]);
}

// ─── Nav filter ───────────────────────────────────────────────────────────────

export type NavItem = {
  href:    string;
  icon:    string;
  label:   string;
  goals?:  WorkspaceGoal[];
  roles?:  AppRole[];
  tourId?: string;
  locked?: boolean;
};

export type NavGroup = {
  id:     string;
  title:  string;
  icon:   string;
  items:  NavItem[];
  roles?: AppRole[];
};

/**
 * Filters the navigation groups and items based on the user's role, workspace
 * goal, and connection state, returning only what the user is allowed to see.
 */
export function filterNavGroups(
  groups:            NavGroup[],
  goal:              WorkspaceGoal,
  role:              AppRole,
  hasConnections:    boolean,
  bypassConnections: boolean,
): NavGroup[] {
  const base = groups
    .filter((g) => !g.roles || g.roles.some((r) => r === role))
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (item) =>
          (!item.goals || item.goals.includes(goal)) &&
          (!item.roles  || item.roles.includes(role)),
      ),
    }))
    .filter((g) => g.items.length > 0);

  if (bypassConnections || hasConnections) return base;

  return base.map((g) => {
    if (g.id === "analytics" || g.id === "operations") {
      return { ...g, items: g.items.map((item) => ({ ...item, locked: true })) };
    }
    return g;
  });
}
