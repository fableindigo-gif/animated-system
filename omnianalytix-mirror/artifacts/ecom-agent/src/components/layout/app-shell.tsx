import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { Settings, Users, CreditCard, HelpCircle, LogOut, User, Search, ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { FaqDrawer } from "@/components/help/faq-drawer";
import { SupportFab } from "@/components/help/support-fab";
import { authFetch } from "@/lib/auth-fetch";
import { CommandPalette } from "@/components/command-palette";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCredits } from "@/contexts/credits-context";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { CurrencySwitcher } from "@/components/layout/currency-switcher";
import { AgencySetupWizard, agencySetupNeeded } from "@/components/onboarding/agency-setup";
import { ProductTour } from "@/components/onboarding/product-tour";
import { OmniCopilotWidget } from "@/components/copilot/floating-widget";
import { useListConnections } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const BASE       = import.meta.env.BASE_URL.replace(/\/$/, "");
const SIDEBAR_BG = "rgb(0, 74, 198)";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkspaceGoal = "ecom" | "leadgen" | "hybrid";
type AppRole       = "super_admin" | "admin" | "agency_owner" | "manager" | "analyst" | "it" | "viewer" | "member";
type NavItem       = {
  href:    string;
  icon:    string;
  label:   string;
  goals?:  WorkspaceGoal[];
  roles?:  AppRole[];
  tourId?: string;   // DOM id for react-joyride targeting
  locked?: boolean;  // true → rendered as disabled (opacity + lock icon), not navigable
};
type NavGroup = {
  id:     string;
  title:  string;
  icon:   string;
  items:  NavItem[];
  roles?: AppRole[];
};

const ADMIN_ROLES: AppRole[] = ["admin", "agency_owner"];

// ─── Navigation Groups (4-Tier IA) ────────────────────────────────────────────
// Strategy    — High-level intelligence + analytics
// Execution   — Day-to-day operations, actions, health
// Growth Engines — Premium AI features (enrichment, agents, promos)
// Administration — Platform config, billing, team

const NAV_GROUPS: NavGroup[] = [
  {
    id: "strategy",
    title: "Strategy",
    icon: "query_stats",
    items: [
      { href: "/",                      icon: "dashboard",    label: "Dashboard",              tourId: undefined },
      { href: "/agency/command-center", icon: "smart_toy",   label: "AI Command Center"        },
      { href: "/ai-conversations",      icon: "forum",       label: "AI Conversations"         },
      { href: "/admin/clients",         icon: "domain",      label: "Client Accounts",         roles: ADMIN_ROLES },
      { href: "/capabilities",          icon: "auto_awesome",label: "Omni-Channel Optimization"},
      { href: "/pipeline-funnel",       icon: "filter_alt",  label: "Pipeline Funnel",         goals: ["leadgen", "hybrid"] },
      { href: "/sales-leaderboard",     icon: "leaderboard", label: "Sales Leaderboard",       goals: ["leadgen", "hybrid"] },
      { href: "/spreadsheets",          icon: "table_chart",  label: "Spreadsheets"              },
      { href: "/data-modeling",         icon: "schema",       label: "Custom Attribution"        },
      { href: "/profit-loss",           icon: "receipt_long", label: "P&L Statement"             },
      { href: "/insights",              icon: "insights",     label: "Cross-Platform Insights"   },
    ],
  },
  {
    id: "execution",
    title: "Execution",
    icon: "engineering",
    items: [
      { href: "/tasks",           icon: "assignment",    label: "Action Items",  tourId: "tour-nav-tasks" },
      { href: "/forensic",        icon: "monitoring",    label: "Account Health"                         },
      { href: "/resolution-base", icon: "library_books", label: "Execution Logs"                        },
      { href: "/client-brief",    icon: "summarize",     label: "Client Brief",  goals: ["ecom", "hybrid"] },
    ],
  },
  {
    id: "growth_engines",
    title: "Growth Engines",
    icon: "rocket_launch",
    items: [
      { href: "/feed-enrichment",  icon: "auto_fix_high",         label: "Feed Enrichment"     },
      { href: "/agent-builder",    icon: "smart_toy",             label: "AI Agent Builder"    },
      { href: "/promo-engine",     icon: "local_fire_department", label: "Promo Intelligence"  },
      { href: "/google-ads-hub",   icon: "ads_click",             label: "Google Ads Reports"  },
      { href: "/shopping-insights",icon: "shopping_cart",         label: "Shopping Insights"   },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    icon: "admin_panel_settings",
    roles: ADMIN_ROLES,
    items: [
      { href: "/connections",        icon: "cable",           label: "Platform Integrations", tourId: "tour-nav-connections" },
      { href: "/team",               icon: "group",           label: "Team & Access",  roles: ADMIN_ROLES },
      { href: "/billing-hub",        icon: "account_balance", label: "Billing",        roles: ADMIN_ROLES },
      { href: "/settings",           icon: "tune",            label: "Settings",       roles: ADMIN_ROLES },
      { href: "/reports/templates",  icon: "description",     label: "Report Templates", roles: ADMIN_ROLES },
      { href: "/docs",               icon: "menu_book",       label: "Documentation"   },
    ],
  },
];

// ─── Progressive Disclosure Filter ───────────────────────────────────────────
// Behaviour by role + connection state:
//
//  Admins / agency_owner / super_admin
//    → Always see every group and every item, fully interactive.
//      The connections check is bypassed entirely.
//
//  All other roles, workspace has connections
//    → All role-appropriate groups and items are shown, fully interactive.
//
//  All other roles, workspace has NO connections (empty state)
//    → Overview and Administration groups show normally.
//    → Analytics and Operations items are rendered with locked=true:
//      half-opacity, cursor-not-allowed, pointer-events-none, lock icon.
//      This surfaces what exists rather than hiding it, encouraging users
//      to connect a platform.

const BYPASS_ROLES: AppRole[] = ["super_admin", "admin", "agency_owner"];

function filterNav(
  groups:            NavGroup[],
  goal:              WorkspaceGoal,
  role:              AppRole,
  hasConnections:    boolean,
  bypassConnections: boolean,
): NavGroup[] {
  // Step 1: Role + goal filter (always applied).
  const base = groups
    .filter((g) => !g.roles || g.roles.includes(role))
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (item) =>
          (!item.goals || item.goals.includes(goal)) &&
          (!item.roles  || item.roles.includes(role)),
      ),
    }))
    .filter((g) => g.items.length > 0);

  // Step 2: If admin-level role or connected workspace → full nav, no locks.
  if (bypassConnections || hasConnections) return base;

  // Step 3: Non-admin, no connections → mark Execution + Growth Engines as locked.
  // Strategy and Administration remain fully interactive (overview-equivalent groups).
  return base.map((g) => {
    if (g.id === "execution" || g.id === "growth_engines") {
      return { ...g, items: g.items.map((item) => ({ ...item, locked: true })) };
    }
    return g;
  });
}

// ─── Page titles ──────────────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  "/":                      "Performance & AI Logs",
  "/connections":           "Platform Integrations",
  "/forensic":              "Account Health",
  "/agency/command-center": "AI Command Center",
  "/tasks":                 "Action Items",
  "/team":                  "Team & Access",
  "/settings":              "Workspace Settings",
  "/billing-hub":           "Billing & Pacing",
  "/capabilities":          "Omni-Channel Optimization",
  "/spreadsheets":          "Spreadsheets",
  "/data-modeling":         "Custom Attribution",
  "/pipeline-funnel":       "Pipeline Funnel",
  "/sales-leaderboard":     "Sales Leaderboard",
  "/admin/clients":         "Client Portfolio Management",
  "/resolution-base":       "Execution Logs",
  "/client-brief":          "Client Brief",
  "/feed-enrichment":       "Feed Enrichment",
  "/agent-builder":         "AI Agent Builder",
  "/ai-conversations":      "AI Conversations",
  "/promo-engine":          "Promo Intelligence Engine",
  "/profit-loss":           "P&L Statement",
  "/google-ads-hub":        "Google Ads Reports",
  "/insights":              "Cross-Platform Insights",
  "/shopping-insights":     "Shopping Insights",
  "/docs":                  "Documentation",
  "/profile":               "Profile Settings",
  "/reports/templates":     "Report Templates",
};

// ─── Mobile tabs ─────────────────────────────────────────────────────────────

const MOBILE_TABS = [
  { href: "/",             icon: "home",        label: "Home"   },
  { href: "/capabilities", icon: "auto_awesome", label: "Optimization" },
  { href: "/spreadsheets", icon: "table_chart", label: "Data"        },
  { href: "/tasks",        icon: "assignment",  label: "Actions"     },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserInitials(): string {
  const name = localStorage.getItem("omni_user_name");
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return "A";
}

function handleSignOut() {
  localStorage.removeItem("omnianalytix_gate_token");
  localStorage.removeItem("omni_current_user_id");
  localStorage.removeItem("omni_user_name");
  localStorage.removeItem("omni_user_email");
  localStorage.removeItem("omni_user_avatar");
  localStorage.removeItem("omni_user_role");
  localStorage.removeItem("omni_preauth_done");
  window.location.href = import.meta.env.BASE_URL || "/";
}

// ─── SidebarGroup — collapsible accordion + slim (icon-only) mode ─────────────

function SidebarGroup({
  group,
  location,
  pendingTaskCount,
  defaultOpen,
  collapsed,
}: {
  group:            NavGroup;
  location:         string;
  pendingTaskCount: number;
  defaultOpen:      boolean;
  collapsed?:       boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);

  // ── Slim (icon-only) mode ─────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 py-0.5">
        {group.items.map((item) => {
          if (item.locked) return null;
          const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
          const showBadge = item.href === "/tasks" && pendingTaskCount > 0;
          return (
            <Link key={item.href + item.label} href={item.href}>
              <span
                title={item.label}
                aria-label={item.label}
                className={cn(
                  "relative flex items-center justify-center w-10 h-10 rounded-xl transition-all cursor-pointer",
                  isActive ? "bg-white/22 shadow-inner" : "hover:bg-white/10",
                )}
              >
                <span
                  className="material-symbols-outlined text-[18px] shrink-0"
                  style={{
                    color: isActive ? "#fff" : "rgba(255,255,255,0.55)",
                    fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                  }}
                >
                  {item.icon}
                </span>
                {showBadge && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-white text-[rgb(0,74,198)] text-[8px] font-black rounded-full flex items-center justify-center leading-none">
                    {pendingTaskCount > 9 ? "9+" : pendingTaskCount}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  const isGroupActive = group.items.some(
    (item) => item.href === "/" ? location === "/" : location.startsWith(item.href),
  );

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`nav-group-${group.id}`}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.12em] transition-all focus:outline-none",
        )}
        style={{
          color: isGroupActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
          background: isGroupActive && open ? "rgba(255,255,255,0.08)" : "transparent",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.8)"; }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = isGroupActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";
        }}
        aria-expanded={open}
      >
        <span
          className="material-symbols-outlined text-[15px] shrink-0"
          style={{
            fontVariationSettings: isGroupActive ? "'FILL' 1" : "'FILL' 0",
            color: isGroupActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
          }}
        >
          {group.icon}
        </span>
        <span className="flex-1 text-left whitespace-nowrap truncate">{group.title}</span>
        <m.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="shrink-0 opacity-50"
        >
          <ChevronDown className="w-3 h-3" />
        </m.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            key="items"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.05, 0.7, 0.1, 1.0] }}
            style={{ overflow: "hidden", willChange: "transform, opacity" }}
          >
            <div className="flex flex-col gap-0.5 pl-2 pr-1 pb-1 pt-0.5">
              {group.items.map((item, idx) => {
                const isActive = item.href === "/"
                  ? location === "/"
                  : location.startsWith(item.href);
                const showBadge = item.href === "/tasks" && pendingTaskCount > 0;

                // ── Locked item (no connections, non-admin) ──────────────────
                if (item.locked) {
                  return (
                    <m.span
                      key={item.href + item.label}
                      id={item.tourId}
                      title="Connect a platform to unlock"
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium opacity-40 cursor-not-allowed pointer-events-none select-none"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 0.4, x: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.02, ease: [0.4, 0, 0.2, 1] }}
                      style={{ willChange: "transform, opacity" }}
                    >
                      <span
                        className="material-symbols-outlined text-[17px] shrink-0"
                        style={{ color: "rgba(255,255,255,0.5)", fontVariationSettings: "'FILL' 0" }}
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate whitespace-nowrap text-white/70">{item.label}</span>
                      <span
                        className="material-symbols-outlined text-[13px] shrink-0"
                        style={{ color: "rgba(255,255,255,0.4)", fontVariationSettings: "'FILL' 1" }}
                      >
                        lock
                      </span>
                    </m.span>
                  );
                }

                // ── Normal interactive item ──────────────────────────────────
                return (
                  <Link key={item.href + item.label} href={item.href}>
                    <m.span
                      id={item.tourId}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors duration-150 cursor-pointer",
                        isActive ? "text-white" : "text-white/65 hover:text-white",
                      )}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: idx * 0.02, ease: [0.4, 0, 0.2, 1] }}
                      style={{
                        willChange: "transform, opacity",
                        ...(isActive ? {
                          background: "rgba(255,255,255,0.18)",
                          boxShadow: "inset 2px 0 0 rgba(255,255,255,0.7)",
                        } : {}),
                      }}
                      onHoverStart={(e) => {
                        if (!isActive) (e.target as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                      }}
                      onHoverEnd={(e) => {
                        if (!isActive) (e.target as HTMLElement).style.background = "";
                      }}
                    >
                      <span
                        className="material-symbols-outlined text-[17px] shrink-0"
                        style={{
                          color: isActive ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.55)",
                          fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
                        }}
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate whitespace-nowrap">{item.label}</span>
                      {showBadge && (
                        <m.span
                          className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center shrink-0"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 20 }}
                        >
                          {pendingTaskCount}
                        </m.span>
                      )}
                    </m.span>
                  </Link>
                );
              })}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── UnlockBanner — shown in the sidebar when no connections exist ──────────

function UnlockBanner() {
  return (
    <div
      className="mx-3 my-2 rounded-xl px-3 py-3 text-[12px] text-white/80 leading-snug"
      style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}
    >
      <span className="material-symbols-outlined text-[16px] align-middle mr-1.5 opacity-70" style={{ fontVariationSettings: "'FILL' 1" }}>
        lock
      </span>
      Connect a platform to unlock Analytics and Operations.
    </div>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location, navigate]          = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [faqOpen, setFaqOpen]         = useState(false);
  const [searchOpen, setSearchOpen]   = useState(false);
  const profileRef                    = useRef<HTMLDivElement>(null);

  // ── Collapsible sidebar ───────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("omni_sidebar_collapsed") === "true"; } catch { return false; }
  });
  // showLabels drives the slim vs full nav content switch.
  // On collapse  → hide labels immediately (before width shrinks) — no wrapping.
  // On expand    → reveal labels after 110 ms so the width animation has a head start.
  const [showLabels, setShowLabels] = useState(() => {
    try { return localStorage.getItem("omni_sidebar_collapsed") !== "true"; } catch { return true; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("omni_sidebar_collapsed", String(next)); } catch { /* ignore */ }
      if (next) {
        setShowLabels(false);
      } else {
        setTimeout(() => setShowLabels(true), 110);
      }
      return next;
    });
  }, []);

  // Track whether we are on a lg+ (desktop) screen so the sidebar margin
  // is only applied on desktop (the sidebar is hidden on mobile).
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 1024,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const sidebarWidth = isDesktop ? (sidebarCollapsed ? 72 : 260) : 0;
  const { toast }                     = useToast();
  const { activeWorkspace, workspaces, isLoading: wsLoading } = useWorkspace();

  const [wizardDismissed, setWizardDismissed] = useState(false);
  const needsSetup      = agencySetupNeeded(workspaces, wsLoading);
  const showAgencySetup = !wizardDismissed && needsSetup;

  const resolvedGoal: WorkspaceGoal = useMemo(() => {
    const raw = activeWorkspace?.primaryGoal;
    if (raw === "leadgen" || raw === "hybrid") return raw;
    return "ecom";
  }, [activeWorkspace?.primaryGoal]);

  const userRole     = ((localStorage.getItem("omni_user_role") || "member").toLowerCase()) as AppRole;
  const isAdmin      = userRole === "admin" || userRole === "agency_owner";
  const { credits: aiCredits } = useCredits();
  const isSuperAdmin = userRole === "super_admin";

  // Admins and super_admins bypass the connections gate entirely.
  const bypassConnections = BYPASS_ROLES.includes(userRole);

  // ── Connection state for progressive disclosure ──────────────────────────
  // isPending: true while the connections query is in-flight.
  // While loading we optimistically treat the workspace as "connected" so
  // non-admin users never see a false-empty (locked) sidebar on first render.
  const { data: connections, isPending: connectionsLoading } = useListConnections();
  const connCount      = connections?.length ?? -1;   // -1 = still loading
  const hasConnections = connectionsLoading || connCount > 0;

  // Fire an unlock toast the first time connections go from 0 → >0
  const prevConnCount = useRef<number>(-1); // -1 = not yet observed
  useEffect(() => {
    if (connCount < 0) return;   // still loading, skip
    if (connCount === 0) {
      prevConnCount.current = 0;
      return;
    }
    if (prevConnCount.current === 0 && connCount > 0) {
      toast({
        title: "🎉 Platform connected!",
        description: "Analytics and Operations are now unlocked. Let's explore your data.",
        duration: 5000,
      });
    }
    prevConnCount.current = connCount;
  }, [connCount, toast]);

  // ── Filtered nav based on connections, role, and admin bypass ────────────
  const filteredNavGroups = useMemo(
    () => filterNav(NAV_GROUPS, resolvedGoal, userRole, hasConnections, bypassConnections),
    [resolvedGoal, userRole, hasConnections, bypassConnections],
  );

  const activeGroupId = useMemo(() => {
    for (const g of filteredNavGroups) {
      if (g.items.some((item) => item.href === "/" ? location === "/" : location.startsWith(item.href))) {
        return g.id;
      }
    }
    return null;
  }, [filteredNavGroups, location]);

  const pageTitle = useMemo(() => {
    for (const [path, title] of Object.entries(PAGE_TITLES)) {
      if (location === path || (path !== "/" && location.startsWith(path))) return title;
    }
    return "Dashboard";
  }, [location]);

  // ── Close profile dropdown on outside click ───────────────────────────────
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileOpen]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen((v) => !v); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setFaqOpen((v) => !v); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener("omni:open-command-palette", handler);
    return () => window.removeEventListener("omni:open-command-palette", handler);
  }, []);

  // ── Pending task count polling ────────────────────────────────────────────
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await authFetch(`${BASE}/api/tasks/count`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setPendingTaskCount(data.count ?? 0);
        }
      } catch { /* silent */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    const onTaskChange = () => { fetchCount(); };
    window.addEventListener("omni:task-count-changed", onTaskChange);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener("omni:task-count-changed", onTaskChange); };
  }, []);

  const initials   = getUserInitials();
  const avatarUrl  = localStorage.getItem("omni_user_avatar");
  // Greeting first-name source-of-truth: prefer the dedicated
  // `omni_user_first_name` field (written by signup/profile flows). When
  // that is absent we fall back to slicing `omni_user_name`, which can
  // be contaminated with brand strings like "John's Store" — split on
  // whitespace AND straight + curly apostrophes so the possessive never
  // renders.
  const dedicatedFirstName = (localStorage.getItem("omni_user_first_name") || "").trim();
  const firstName = dedicatedFirstName
    || (localStorage.getItem("omni_user_name") || "").split(/[\s'\u2018\u2019]/u)[0]
    || null;
  const isTabActive = (href: string) => href === "/" ? location === "/" : location.startsWith(href);

  return (
    <LazyMotion features={domAnimation} strict>
    <div className="h-screen w-full bg-surface text-on-surface overflow-hidden flex flex-col">

      {/* ── Top Header — glassmorphism ─────────────────────────────────── */}
      <header
        className="fixed top-0 w-full z-50 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)", background: "rgba(255,255,255,0.88)", borderBottom: "none", boxShadow: "0 1px 0 rgba(15,23,42,0.06)" }}
      >
        <div className="flex justify-between items-center px-5 sm:px-6 h-16 w-full">
          <div className="lg:hidden flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-omni-primary/10 flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-omni-primary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
            </div>
            <span className="font-heading text-[15px] font-bold tracking-tight text-slate-800">OmniAnalytix</span>
          </div>

          <m.div
            className="hidden lg:flex items-center gap-2 text-sm"
            initial={false}
            animate={{ marginLeft: sidebarWidth }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            <span className="text-slate-400 text-xs font-medium">OmniAnalytix</span>
            <span className="text-slate-300 text-xs">/</span>
            <span className="font-heading text-xs font-semibold text-slate-700">{pageTitle}</span>
          </m.div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* ── Command Pill search trigger ─────────────────────────── */}
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden sm:flex items-center gap-2.5 px-4 py-2 rounded-full text-sm cursor-pointer min-w-[240px] transition-all duration-150 bg-slate-100/80 hover:bg-slate-100 border border-slate-200/80 hover:border-slate-300/80 shadow-inner"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500 flex-1 text-left">Search commands…</span>
              <kbd className="ml-auto text-[10px] font-mono text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shadow-sm">⌘K</kbd>
            </button>

            {firstName && (
              <span
                className="hidden lg:inline-block text-xs font-medium whitespace-nowrap select-none text-slate-600"
                style={{ letterSpacing: "0.01em" }}
              >
                Welcome back, {firstName}
              </span>
            )}

            {/* ── Display-currency switcher ───────────────────────────── */}
            <CurrencySwitcher />

            {/* ── AI Creative Credits badge ───────────────────────────── */}
            {aiCredits > 0 && (
              <div
                className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full border cursor-default select-none"
                style={{
                  background: "rgba(124,58,237,0.07)",
                  borderColor: "rgba(124,58,237,0.20)",
                }}
                title={`${aiCredits.toLocaleString()} AI Creative credits`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 12, color: "#7c3aed", fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                <span className="text-[10px] font-bold font-mono" style={{ color: "#7c3aed" }}>{aiCredits.toLocaleString()}</span>
              </div>
            )}

            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold hover:bg-slate-200 transition-all overflow-hidden border-2 border-slate-200/80"
                aria-label="Account menu"
              >
                {avatarUrl
                  ? <img
                      src={avatarUrl}
                      alt={`${localStorage.getItem("omni_user_name") || "User"} avatar`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  : initials}
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200 shadow-2xl">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <p className="font-heading text-sm font-semibold text-on-surface truncate tracking-tight">
                      {localStorage.getItem("omni_user_name") || "User"}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate mt-0.5">{localStorage.getItem("omni_user_email") || ""}</p>
                  </div>
                  <div className="px-2 py-1">
                    <Link href="/connections">
                      <button onClick={() => setProfileOpen(false)} className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-slate-50 rounded-xl flex items-center gap-3 transition-colors">
                        <Settings className="w-4 h-4 text-on-surface-variant" /> Workspace Settings
                      </button>
                    </Link>
                    <Link href="/profile">
                      <button onClick={() => setProfileOpen(false)} className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-slate-50 rounded-xl flex items-center gap-3 transition-colors">
                        <User className="w-4 h-4 text-on-surface-variant" /> Profile Settings
                      </button>
                    </Link>
                    {isAdmin && (
                      <Link href="/team">
                        <button onClick={() => setProfileOpen(false)} className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-slate-50 rounded-xl flex items-center gap-3 transition-colors">
                          <Users className="w-4 h-4 text-on-surface-variant" /> Team & Access
                        </button>
                      </Link>
                    )}
                    {isAdmin && (
                      <button onClick={() => { setProfileOpen(false); navigate("/billing-hub"); }} className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-slate-50 rounded-xl flex items-center gap-3 transition-colors">
                        <CreditCard className="w-4 h-4 text-on-surface-variant" /> Billing
                      </button>
                    )}
                    {isSuperAdmin && (
                      <Link href="/platform-admin">
                        <button onClick={() => setProfileOpen(false)} className="w-full text-left px-3 py-2.5 text-sm text-[#004ac6] hover:bg-blue-50 rounded-xl flex items-center gap-3 transition-colors">
                          <ShieldCheck className="w-4 h-4" /> Platform Admin
                        </button>
                      </Link>
                    )}
                  </div>
                  <div className="px-2 pb-1">
                    <button onClick={() => { setProfileOpen(false); setFaqOpen(true); }} className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-slate-50 rounded-xl flex items-center gap-3 transition-colors">
                      <HelpCircle className="w-4 h-4 text-on-surface-variant" /> Help & Support
                    </button>
                  </div>
                  <div className="px-2 pb-3 border-t border-slate-100 mt-1">
                    <button onClick={handleSignOut} className="w-full text-left px-3 py-2.5 text-sm text-error-m3 hover:bg-red-50 rounded-xl flex items-center gap-3 transition-colors mt-1">
                      <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Desktop Sidebar (collapsible) ────────────────────────────────── */}
      <m.aside
        className="h-screen fixed left-0 top-0 hidden lg:flex flex-col z-40 overflow-hidden"
        initial={false}
        animate={{ width: sidebarCollapsed ? 72 : 260 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        style={{ background: SIDEBAR_BG, borderRight: "1px solid rgba(255,255,255,0.15)", willChange: "width" }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3 px-4 h-16 shrink-0 overflow-hidden"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}
        >
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shadow-md shrink-0">
            <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
          </div>
          <AnimatePresence initial={false}>
            {!sidebarCollapsed && (
              <m.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <p className="font-heading text-[15px] font-bold tracking-tight text-white leading-tight whitespace-nowrap">OmniAnalytix</p>
                <p className="text-[11px] font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.6)" }}>Enterprise BI</p>
              </m.div>
            )}
          </AnimatePresence>
        </div>

        {/* Workspace Switcher — hidden when slim */}
        <AnimatePresence initial={false}>
          {showLabels && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="px-0 py-3">
                <WorkspaceSwitcher />
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {/* Progressive disclosure banner — only for non-admins with no connections */}
        {!hasConnections && !bypassConnections && showLabels && <UnlockBanner />}

        {/* Nav groups */}
        <nav className={cn(
          "flex flex-col flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent",
          !showLabels ? "gap-0 px-2 py-3 items-center" : "gap-1 px-3 py-4",
        )}>
          {!showLabels ? (
            // Slim mode: flat icon list grouped by a hairline divider
            filteredNavGroups.map((group, i) => (
              <div key={group.id} className={cn("w-full", i > 0 && "pt-1 mt-1 border-t border-white/[0.08]")}>
                <SidebarGroup
                  group={group}
                  location={location}
                  pendingTaskCount={pendingTaskCount}
                  defaultOpen={false}
                  collapsed={true}
                />
              </div>
            ))
          ) : (
            filteredNavGroups.map((group) => (
              <SidebarGroup
                key={group.id}
                group={group}
                location={location}
                pendingTaskCount={pendingTaskCount}
                defaultOpen={group.id === activeGroupId}
                collapsed={false}
              />
            ))
          )}
        </nav>

        {/* Bottom: New Audit CTA + Help + Collapse toggle */}
        <div
          className="flex flex-col gap-1 px-3 py-4 shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}
        >
          {/* New Audit CTA */}
          {sidebarCollapsed ? (
            <button
              title="New Audit"
              onClick={() => {
                sessionStorage.setItem("omni_inject_audit", "true");
                if (location === "/") {
                  window.dispatchEvent(new StorageEvent("storage", { key: "omni_inject_audit", newValue: "true" }));
                } else { navigate("/"); }
              }}
              className="flex items-center justify-center w-10 h-10 rounded-xl mx-auto active:scale-95 transition-all"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
            </button>
          ) : (
            <button
              onClick={() => {
                sessionStorage.setItem("omni_inject_audit", "true");
                if (location === "/") {
                  window.dispatchEvent(new StorageEvent("storage", { key: "omni_inject_audit", newValue: "true" }));
                } else { navigate("/"); }
              }}
              className="w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-all rounded-xl"
              style={{ background: "rgba(255,255,255,1)", color: "rgb(0, 74, 198)", boxShadow: "0 4px 16px rgba(0,0,0,0.2)", fontFamily: "'Manrope', sans-serif" }}
            >
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
              New Audit
            </button>
          )}

          {/* Help — hidden when collapsed */}
          {!sidebarCollapsed && (
            <button
              onClick={() => setFaqOpen(true)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer w-full text-left transition-colors"
              style={{ color: "rgba(255,255,255,0.55)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLElement).style.background = ""; }}
            >
              <span className="material-symbols-outlined text-[18px] opacity-60">help</span>
              Support
            </button>
          )}

          {/* ── Collapse / Expand toggle ─────────────────────────────────── */}
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse to slim view"}
            className={cn(
              "flex items-center rounded-xl text-[12px] font-medium transition-all",
              sidebarCollapsed
                ? "justify-center w-10 h-10 mx-auto hover:bg-white/10"
                : "gap-2 px-3 py-2.5 w-full hover:bg-white/10",
            )}
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            <m.span
              animate={{ rotate: sidebarCollapsed ? 0 : 180 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="shrink-0"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </m.span>
            {!sidebarCollapsed && <span className="opacity-80">Collapse</span>}
          </button>
        </div>
      </m.aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <m.main
        className="flex-1 overflow-auto min-h-0"
        initial={false}
        animate={{ marginLeft: sidebarWidth }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 4rem)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          willChange: "margin-left",
        }}
      >
        <div className="sm:pt-2 pb-24 lg:pb-4">
          {children}
        </div>
      </m.main>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-100"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex justify-around items-stretch px-2">
          {MOBILE_TABS.map((tab) => {
            const active = isTabActive(tab.href);
            return (
              <button
                key={tab.href}
                onClick={() => navigate(tab.href)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-3 px-4 flex-1 min-w-0 rounded-xl transition-all",
                  active ? "text-primary-container" : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                <span
                  className="material-symbols-outlined text-[22px]"
                  style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {tab.icon}
                </span>
                <span className="text-[10px] font-semibold truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Overlays & utilities ──────────────────────────────────────────── */}
      {showAgencySetup && (
        <AgencySetupWizard
          onComplete={() => setWizardDismissed(true)}
        />
      )}
      <FaqDrawer isOpen={faqOpen} onClose={() => setFaqOpen(false)} />
      <SupportFab onOpenFaq={() => setFaqOpen(true)} />
      <CommandPalette
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onExecute={(prompt) => {
          // Bridge palette → home chat input via the existing event channel.
          window.dispatchEvent(new CustomEvent("omni:command-prompt", { detail: prompt }));
          setSearchOpen(false);
        }}
      />

      {/* ── Product tour (first-session only) ────────────────────────────── */}
      <ProductTour />

      {/* ── OmniCopilot floating widget ───────────────────────────────────── */}
      <OmniCopilotWidget />
    </div>
    </LazyMotion>
  );
}
