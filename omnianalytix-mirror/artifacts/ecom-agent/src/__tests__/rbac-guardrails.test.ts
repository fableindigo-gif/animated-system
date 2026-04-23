/**
 * RBAC Guardrails — VAG 4/5/6 Assurance Protocol
 * ─────────────────────────────────────────────────────────────────────────────
 * Simulates CLIENT_VIEWER login and asserts all three acceptance criteria:
 *   1. The "Administration" nav group is absent from the filtered nav
 *   2. The "Agency Portfolio" item is absent for viewers
 *   3. Action buttons (new-task, new-operation, approve, execute) are gated
 *
 * Pure function tests — no DOM or network required.
 */
import { describe, it, expect } from "vitest";
import {
  hasPermission,
  canApproveImpact,
  filterNavGroups,
  ROLE_RANK,
  type AppRole,
  type NavGroup,
  type WorkspaceGoal,
} from "@/lib/rbac-utils";

// ─── Sample nav structure (mirrors app-shell NAV_GROUPS) ─────────────────────

const ADMIN_ROLES: AppRole[] = ["super_admin", "admin", "agency_owner"];

const MOCK_NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    title: "Overview",
    icon: "home",
    items: [
      { href: "/",              icon: "dashboard",  label: "Dashboard"        },
      { href: "/admin/clients", icon: "domain",     label: "Agency Portfolio", roles: ADMIN_ROLES },
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: "insights",
    items: [
      { href: "/profit-loss", icon: "analytics", label: "P&L", goals: ["ecom", "hybrid"] },
      { href: "/spreadsheets", icon: "table_chart", label: "Spreadsheets" },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    icon: "engineering",
    items: [
      { href: "/tasks",   icon: "assignment", label: "Task Board" },
      { href: "/forensic", icon: "monitoring", label: "Live Triage" },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    icon: "admin_panel_settings",
    roles: ADMIN_ROLES,
    items: [
      { href: "/connections", icon: "cable",  label: "Connections"                 },
      { href: "/team",        icon: "group",  label: "Team & Access", roles: ADMIN_ROLES },
      { href: "/settings",    icon: "tune",   label: "Settings",      roles: ADMIN_ROLES },
    ],
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function navFor(role: AppRole, goal: WorkspaceGoal = "ecom", hasConnections = true) {
  return filterNavGroups(MOCK_NAV_GROUPS, goal, role, hasConnections, ADMIN_ROLES.includes(role));
}

function groupIds(role: AppRole, goal?: WorkspaceGoal) {
  return navFor(role, goal).map((g) => g.id);
}

function allItemHrefs(role: AppRole) {
  return navFor(role).flatMap((g) => g.items.map((i) => i.href));
}

// ─── VAG 5: Administration group is absent for CLIENT_VIEWER ─────────────────

describe("VAG 5 — Route Guards: Administration group visibility", () => {
  it("CLIENT_VIEWER does NOT see the Administration group", () => {
    expect(groupIds("viewer")).not.toContain("administration");
  });

  it("CLIENT_VIEWER does NOT see Agency Portfolio nav item", () => {
    expect(allItemHrefs("viewer")).not.toContain("/admin/clients");
  });

  it("admin DOES see the Administration group", () => {
    expect(groupIds("admin")).toContain("administration");
  });

  it("agency_owner DOES see the Administration group", () => {
    expect(groupIds("agency_owner")).toContain("administration");
  });

  it("manager does NOT see the Administration group", () => {
    expect(groupIds("manager")).not.toContain("administration");
  });

  it("analyst does NOT see the Administration group", () => {
    expect(groupIds("analyst")).not.toContain("administration");
  });
});

// ─── VAG 4: Workspace scoping — role rank ordering ───────────────────────────

describe("VAG 4 — Workspace context: role ranks are correctly ordered", () => {
  it("super_admin outranks admin", () => {
    expect(ROLE_RANK["super_admin"]).toBeGreaterThan(ROLE_RANK["admin"]);
  });

  it("admin outranks manager", () => {
    expect(ROLE_RANK["admin"]).toBeGreaterThan(ROLE_RANK["manager"]);
  });

  it("manager outranks analyst", () => {
    expect(ROLE_RANK["manager"]).toBeGreaterThan(ROLE_RANK["analyst"]);
  });

  it("analyst outranks viewer", () => {
    expect(ROLE_RANK["analyst"]).toBeGreaterThan(ROLE_RANK["viewer"]);
  });

  it("viewer has the lowest rank", () => {
    expect(ROLE_RANK["viewer"]).toBe(1);
  });
});

// ─── VAG 6: hasPermission utility ────────────────────────────────────────────

describe("VAG 6 — useHasPermission: action button guardrails", () => {
  it("viewer CANNOT perform analyst-level actions (New Task / New Operation)", () => {
    expect(hasPermission("viewer", "analyst")).toBe(false);
  });

  it("viewer CANNOT perform manager-level actions", () => {
    expect(hasPermission("viewer", "manager")).toBe(false);
  });

  it("viewer CANNOT perform admin-level actions", () => {
    expect(hasPermission("viewer", "admin")).toBe(false);
  });

  it("analyst CAN perform analyst-level actions", () => {
    expect(hasPermission("analyst", "analyst")).toBe(true);
  });

  it("manager CAN perform analyst-level actions (higher rank)", () => {
    expect(hasPermission("manager", "analyst")).toBe(true);
  });

  it("admin CAN perform all actions", () => {
    expect(hasPermission("admin", "admin")).toBe(true);
    expect(hasPermission("admin", "manager")).toBe(true);
    expect(hasPermission("admin", "analyst")).toBe(true);
  });
});

// ─── VAG 6: canApproveImpact — Approval Queue guardrails ─────────────────────

describe("VAG 6 — Approval Queue: CLIENT_VIEWER cannot approve any impact level", () => {
  it("viewer CANNOT approve LOW-impact actions", () => {
    expect(canApproveImpact("viewer", "LOW")).toBe(false);
  });

  it("viewer CANNOT approve MEDIUM-impact actions", () => {
    expect(canApproveImpact("viewer", "MEDIUM")).toBe(false);
  });

  it("viewer CANNOT approve HIGH-impact actions", () => {
    expect(canApproveImpact("viewer", "HIGH")).toBe(false);
  });

  it("analyst CAN approve LOW-impact actions", () => {
    expect(canApproveImpact("analyst", "LOW")).toBe(true);
  });

  it("analyst CANNOT approve MEDIUM-impact actions", () => {
    expect(canApproveImpact("analyst", "MEDIUM")).toBe(false);
  });

  it("manager CAN approve MEDIUM-impact actions", () => {
    expect(canApproveImpact("manager", "MEDIUM")).toBe(true);
  });

  it("manager CANNOT approve HIGH-impact actions", () => {
    expect(canApproveImpact("manager", "HIGH")).toBe(false);
  });

  it("admin CAN approve HIGH-impact actions", () => {
    expect(canApproveImpact("admin", "HIGH")).toBe(true);
  });
});

// ─── VAG 5: Locked state for non-connected viewers ───────────────────────────

describe("VAG 5 — Lock state: analytics and operations locked for disconnected viewers", () => {
  it("analytics items are locked for viewer with no connections", () => {
    const groups = filterNavGroups(MOCK_NAV_GROUPS, "ecom", "viewer", false, false);
    const analytics = groups.find((g) => g.id === "analytics");
    expect(analytics).toBeDefined();
    expect(analytics?.items.every((i) => i.locked)).toBe(true);
  });

  it("operations items are locked for viewer with no connections", () => {
    const groups = filterNavGroups(MOCK_NAV_GROUPS, "ecom", "viewer", false, false);
    const ops = groups.find((g) => g.id === "operations");
    expect(ops).toBeDefined();
    expect(ops?.items.every((i) => i.locked)).toBe(true);
  });

  it("overview items are NOT locked for viewer (always accessible)", () => {
    const groups = filterNavGroups(MOCK_NAV_GROUPS, "ecom", "viewer", false, false);
    const overview = groups.find((g) => g.id === "overview");
    expect(overview?.items.some((i) => i.locked)).toBe(false);
  });

  it("admin NEVER has locked items regardless of connections", () => {
    const groups = filterNavGroups(MOCK_NAV_GROUPS, "ecom", "admin", false, true);
    expect(groups.flatMap((g) => g.items).some((i) => i.locked)).toBe(false);
  });
});
