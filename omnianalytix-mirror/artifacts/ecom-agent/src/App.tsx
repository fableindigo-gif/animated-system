import { useState, useCallback, useEffect, lazy, Suspense, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/components/password-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AccountProvider } from "@/contexts/account-context";
import { CurrencyProvider } from "@/contexts/currency-context";
import { FxProvider } from "@/contexts/fx-context";
import { UserRoleProvider } from "@/contexts/user-role-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { CreditsProvider } from "@/contexts/credits-context";
import { SubscriptionProvider } from "@/contexts/subscription-context";
import { DateRangeProvider } from "@/contexts/date-range-context";
import { FiltersProvider } from "@/contexts/filters-context";
import { usePreAuthState } from "@/components/enterprise/pre-auth-onboarding";
import { ConnectionsGuard } from "@/components/enterprise/connections-guard";
import { AppShell } from "@/components/layout/app-shell";
import { NewUserConfirmDialog } from "@/components/enterprise/new-user-confirm-dialog";

// ── PERF-01: Route-level code splitting ───────────────────────────────────────
// Every page import below is lazy so route navigation pulls a per-route chunk
// instead of one ~2.8 MB main bundle. <Suspense> renders RouteFallback while a
// chunk is fetched.
//
// Resilience: chunk requests can fail transiently (network blip) or
// permanently (the user's open tab references a chunk hash that no longer
// exists after a fresh deploy). `lazyWithRetry` retries twice with backoff;
// if all retries fail we throw, which the GlobalErrorBoundary in main.tsx
// catches and surfaces as a "Refresh page" UI instead of a blank screen.
function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
) {
  return lazy(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (attempt === retries) break;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("lazy chunk load failed");
  });
}

const NotFound                  = lazyWithRetry(() => import("@/pages/not-found"));
const Home                      = lazyWithRetry(() => import("@/pages/home"));
const Connections               = lazyWithRetry(() => import("@/pages/connections"));
const Team                      = lazyWithRetry(() => import("@/pages/team"));
const PrivacyPolicy             = lazyWithRetry(() => import("@/pages/privacy-policy"));
const AgencyCommandCenter       = lazyWithRetry(() => import("@/pages/agency-command-center"));
const Forensic                  = lazyWithRetry(() => import("@/pages/forensic"));
const TaskBoard                 = lazyWithRetry(() => import("@/pages/task-board"));
const ExecutiveBrief            = lazyWithRetry(() => import("@/pages/executive-brief"));
const ResolutionBase            = lazyWithRetry(() => import("@/pages/resolution-base"));
const CapabilitiesHub           = lazyWithRetry(() => import("@/pages/capabilities-hub"));
const BillingHubPage            = lazyWithRetry(() => import("@/pages/billing-hub"));
const WorkspaceSettings         = lazyWithRetry(() => import("@/pages/workspace-settings"));
const ProfileSettings           = lazyWithRetry(() => import("@/pages/profile-settings"));
const SharedReport              = lazyWithRetry(() => import("@/pages/shared-report"));
const Spreadsheets              = lazyWithRetry(() => import("@/pages/spreadsheets"));
const DataModeling              = lazyWithRetry(() => import("@/pages/data-modeling"));
const DocsHub                   = lazyWithRetry(() => import("@/pages/docs"));
const LandingPage               = lazyWithRetry(() => import("@/pages/landing"));
const LeadCapturePage           = lazyWithRetry(() => import("@/pages/lead-capture"));
const EnterprisePage            = lazyWithRetry(() => import("@/pages/enterprise"));
const AdminClientsPage          = lazyWithRetry(() => import("@/pages/admin-clients"));
const PipelineFunnelPage        = lazyWithRetry(() => import("@/pages/pipeline-funnel"));
const SalesLeaderboardPage      = lazyWithRetry(() => import("@/pages/sales-leaderboard"));
const JoinTeamPage              = lazyWithRetry(() => import("@/pages/join-team"));
const JoinClientPage            = lazyWithRetry(() => import("@/pages/join-client"));
const PlatformAdmin             = lazyWithRetry(() => import("@/pages/platform-admin"));
const ReportTemplates           = lazyWithRetry(() => import("@/pages/report-templates"));
const ReportViewerPage          = lazyWithRetry(() => import("@/pages/report-viewer-page"));
const FeedEnrichmentPage        = lazyWithRetry(() => import("@/pages/feed-enrichment"));
const AgentBuilderPage          = lazyWithRetry(() => import("@/pages/agent-builder"));
const AgentBuilderDetailPage    = lazyWithRetry(() => import("@/pages/agent-builder-detail"));
const AiConversationsPage       = lazyWithRetry(() => import("@/pages/ai-conversations"));
const PromoEnginePage           = lazyWithRetry(() => import("@/pages/promo-engine"));
const ProfitLossPage            = lazyWithRetry(() => import("@/pages/profit-loss"));
const GoogleAdsHubPage          = lazyWithRetry(() => import("@/pages/google-ads-hub"));
const CrossPlatformInsightsPage = lazyWithRetry(() => import("@/pages/cross-platform-insights"));
const ShoppingInsightsPage      = lazyWithRetry(() => import("@/pages/shopping-insights"));
const ActivityLogPage           = lazyWithRetry(() => import("@/pages/activity-log"));

function RouteFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center" aria-busy="true" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-700 animate-spin" />
        <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">Loading…</span>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

function DeepLinkRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const returnPath = sessionStorage.getItem("omni_return_path");
    if (returnPath) {
      sessionStorage.removeItem("omni_return_path");
      navigate(returnPath);
    }
  }, [navigate]);
  return null;
}

function Router() {
  return (
    <AppShell>
      <DeepLinkRedirect />
      <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/connections" component={Connections} />
        <Route path="/team">
          {() => (
            <ProtectedRoute allowedRoles={["admin", "agency_owner", "super_admin"]}>
              <Team />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/privacy-policy" component={PrivacyPolicy} />
        <Route path="/agency/command-center">
          {() => (
            <ProtectedRoute allowedRoles={["super_admin", "admin", "agency_owner", "manager", "analyst", "it", "member"]}>
              <AgencyCommandCenter />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/forensic">
          {() => (
            <ProtectedRoute allowedRoles={["super_admin", "admin", "agency_owner", "manager", "analyst", "it", "member"]}>
              <Forensic />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/tasks">
          {() => (
            <ProtectedRoute allowedRoles={["super_admin", "admin", "agency_owner", "manager", "analyst", "it", "member"]}>
              <TaskBoard />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/client-brief" component={ExecutiveBrief} />
        <Route path="/resolution-base" component={ResolutionBase} />
        <Route path="/capabilities" component={CapabilitiesHub} />
        <Route path="/advanced-suite" component={CapabilitiesHub} />
        <Route path="/billing-hub">
          {() => (
            <ProtectedRoute allowedRoles={["admin", "agency_owner"]}>
              <BillingHubPage />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/settings">
          {() => (
            <ProtectedRoute allowedRoles={["admin", "agency_owner"]}>
              <WorkspaceSettings />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/spreadsheets" component={Spreadsheets} />
        <Route path="/data-modeling" component={DataModeling} />
        <Route path="/pipeline-funnel" component={PipelineFunnelPage} />
        <Route path="/sales-leaderboard" component={SalesLeaderboardPage} />
        <Route path="/reports/templates">
          {() => (
            <ProtectedRoute allowedRoles={["admin", "agency_owner", "super_admin"]}>
              <ReportTemplates />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/reports/:id" component={ReportViewerPage} />
        <Route path="/feed-enrichment" component={FeedEnrichmentPage} />
        <Route path="/agent-builder" component={AgentBuilderPage} />
        <Route path="/agent-builder/:id" component={AgentBuilderDetailPage} />
        <Route path="/ai-conversations" component={AiConversationsPage} />
        <Route path="/promo-engine" component={PromoEnginePage} />
        <Route path="/profit-loss" component={ProfitLossPage} />
        <Route path="/google-ads-hub" component={GoogleAdsHubPage} />
        <Route path="/insights" component={CrossPlatformInsightsPage} />
        <Route path="/shopping-insights" component={ShoppingInsightsPage} />
        <Route path="/activity" component={ActivityLogPage} />
        <Route path="/docs" component={DocsHub} />
        <Route path="/profile" component={ProfileSettings} />
        <Route path="/admin/clients">
          {() => (
            <ProtectedRoute allowedRoles={["admin", "agency_owner", "super_admin"]}>
              <AdminClientsPage />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/platform-admin">
          {() => (
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <PlatformAdmin />
            </ProtectedRoute>
          )}
        </Route>
        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </AppShell>
  );
}

function AuthenticatedApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WorkspaceProvider>
          <CreditsProvider>
          <AccountProvider>
            <CurrencyProvider>
              <FxProvider>
              <UserRoleProvider>
                <SubscriptionProvider>
                  <DateRangeProvider>
                    <FiltersProvider>
                      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                        <ConnectionsGuard>
                          <Router />
                        </ConnectionsGuard>
                      </WouterRouter>
                      <Toaster />
                    </FiltersProvider>
                  </DateRangeProvider>
                </SubscriptionProvider>
              </UserRoleProvider>
              </FxProvider>
            </CurrencyProvider>
          </AccountProvider>
          </CreditsProvider>
        </WorkspaceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function hasSsoCallbackParams(): boolean {
  const params = new URLSearchParams(window.location.search);
  return !!params.get("sso_complete") || !!params.get("sso_token");
}

function getNewUserConfirmParams(): { setupKey: string; name: string; email: string; picture: string } | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.get("sso_new_user_confirm")) return null;
  const setupKey = params.get("sso_setup_key");
  if (!setupKey) return null;
  return {
    setupKey,
    name: params.get("sso_name") ?? "",
    email: params.get("sso_email") ?? "",
    picture: params.get("sso_picture") ?? "",
  };
}

function clearNewUserConfirmParams() {
  const params = new URLSearchParams(window.location.search);
  params.delete("sso_new_user_confirm");
  params.delete("sso_setup_key");
  params.delete("sso_name");
  params.delete("sso_email");
  params.delete("sso_picture");
  const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
  window.history.replaceState({}, "", clean);
}

const NEEDS_ONBOARDING_KEY = "omni_needs_onboarding";

function startGoogleSso() {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const currentPath = window.location.pathname.replace(basePath, "") || "/";
  if (currentPath !== "/" && currentPath !== "") {
    sessionStorage.setItem("omni_return_path", currentPath);
  } else {
    // VIS-01: when starting SSO from root, clear any stale deep-link target
    // left over from a previous unauth visit so we don't redirect the user
    // to an unrelated page after sign-in.
    sessionStorage.removeItem("omni_return_path");
  }
  window.location.href = `${API_BASE}api/auth/gate/sso/start`;
}

function isPublicPath(): { shared: boolean; privacy: boolean; enterprise: boolean; joinTeam: boolean; joinClient: boolean } {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const path = window.location.pathname;
  const relative = basePath ? path.replace(basePath, "") : path;
  return {
    shared: relative.startsWith("/shared/"),
    privacy: relative === "/privacy-policy" || relative === "/privacy-policy/",
    enterprise: relative === "/enterprise" || relative === "/enterprise/",
    joinTeam: relative === "/join/team" || relative === "/join/team/",
    joinClient: relative === "/join/client" || relative === "/join/client/",
  };
}

/**
 * VIS-01: when an unauthenticated user deep-links to a protected dashboard
 * route (anything other than `/`), preserve the original path so we can
 * navigate back after sign-in.
 */
function preserveReturnPathForUnauthenticated() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("omnianalytix_gate_token")) return;
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const path = window.location.pathname;
  const relative = (basePath ? path.replace(basePath, "") : path) || "/";
  // Don't preserve trivial / public paths — those don't need a return target.
  if (relative === "/" || relative === "") return;
  if (relative.startsWith("/shared/")) return;
  if (relative === "/privacy-policy" || relative === "/privacy-policy/") return;
  if (relative === "/enterprise" || relative === "/enterprise/") return;
  if (relative.startsWith("/join/")) return;
  // Preserve the path + query so post-auth DeepLinkRedirect can restore it.
  const search = window.location.search || "";
  sessionStorage.setItem("omni_return_path", `${relative}${search}`);
}

function AuthRequiredPrompt({
  returnPath,
  onSignIn,
  onCancel,
}: {
  returnPath: string;
  onSignIn: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Sign in to continue
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          You need to sign in to view <span className="font-mono text-slate-900">{returnPath}</span>.
          We'll bring you right back here after you authenticate.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="w-full mb-3 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-white text-sm font-medium hover:bg-slate-800 transition"
          data-testid="auth-required-signin"
        >
          Sign in with Google
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-sm text-slate-500 hover:text-slate-700 transition"
          data-testid="auth-required-cancel"
        >
          Go to homepage instead
        </button>
      </div>
    </div>
  );
}

function App() {
  const [, navigate] = useLocation();
  const { complete: preAuthDone, markComplete: markPreAuthDone } = usePreAuthState();
  const hasToken = !!localStorage.getItem("omnianalytix_gate_token");
  const hasSsoCallback = hasSsoCallbackParams();

  // VIS-01: capture deep-link target before any auth fallback rerenders.
  // (Auth-alias paths like `/login`, `/signup`, `/get-started` are
  // intercepted before React mounts — see `interceptAuthAliases()` in
  // main.tsx — so by the time we get here the path is either `/`, a real
  // protected route, or an explicit public path.)
  if (!hasToken && !hasSsoCallback) {
    preserveReturnPathForUnauthenticated();
  }
  const [newUserConfirm, setNewUserConfirm] = useState(getNewUserConfirmParams);
  const [needsOnboarding, setNeedsOnboarding] = useState(
    () => localStorage.getItem(NEEDS_ONBOARDING_KEY) === "true",
  );

  const [showLanding, setShowLanding] = useState(
    () => !hasToken && !hasSsoCallback && !newUserConfirm,
  );
  const [showLeadCapture, setShowLeadCapture] = useState(false);

  const handleNewUserConfirmed = useCallback((data: {
    token: string;
    memberId: number;
    name: string;
    email: string;
    role: string;
    picture?: string | null;
  }) => {
    localStorage.setItem("omnianalytix_gate_token", data.token);
    if (data.name) localStorage.setItem("omni_user_name", data.name);
    if (data.email) localStorage.setItem("omni_user_email", data.email);
    if (data.role) localStorage.setItem("omni_user_role", data.role);
    if (data.picture) localStorage.setItem("omni_user_avatar", data.picture);
    if (data.memberId) localStorage.setItem("omni_current_user_id", String(data.memberId));
    localStorage.setItem(NEEDS_ONBOARDING_KEY, "true");
    clearNewUserConfirmParams();
    setNewUserConfirm(null);
    setNeedsOnboarding(true);
    setShowLanding(false);
  }, []);

  const handleNewUserCancelled = useCallback(() => {
    clearNewUserConfirmParams();
    setNewUserConfirm(null);
    setShowLanding(true);
  }, []);

  const handleOnboardingComplete = useCallback((goal: string, platforms: string[]) => {
    localStorage.removeItem(NEEDS_ONBOARDING_KEY);
    localStorage.setItem("omni_preauth_complete", "true");
    localStorage.setItem("omni_preauth_goal", goal);
    localStorage.setItem("omni_preauth_platforms", JSON.stringify(platforms));
    localStorage.setItem("omni_onboarding_complete", "true");
    setNeedsOnboarding(false);
    markPreAuthDone(goal, platforms);
  }, [markPreAuthDone]);

  // Task #140: the 3-step Client Setup onboarding screens were removed.
  // New users now land directly on the dashboard. Any residual onboarding
  // flags from prior sessions are cleared transparently so returning users
  // are not stuck waiting on a screen that no longer exists. Goal and
  // platform selections now happen in-dashboard via the Connections and
  // workspace settings pages.
  useEffect(() => {
    if (needsOnboarding && hasToken) {
      handleOnboardingComplete("ecom", []);
    }
  }, [needsOnboarding, hasToken, handleOnboardingComplete]);
  useEffect(() => {
    if (!preAuthDone && hasToken && !hasSsoCallback) {
      markPreAuthDone("ecom", []);
    }
  }, [preAuthDone, hasToken, hasSsoCallback, markPreAuthDone]);

  const publicPath = isPublicPath();

  // PERF-01: every branch below renders a `React.lazy` page, so each must be
  // wrapped in a top-level <Suspense> boundary. Without this, the first render
  // before the chunk has resolved will throw a "component suspended" error
  // because the closest Suspense ancestor lives inside <Router> which we
  // never reach for these public paths.
  if (publicPath.shared) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Route path="/shared/:id" component={SharedReport} />
        </WouterRouter>
      </Suspense>
    );
  }

  if (publicPath.privacy) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Route path="/privacy-policy" component={PrivacyPolicy} />
        </WouterRouter>
      </Suspense>
    );
  }

  if (publicPath.enterprise) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Route path="/enterprise">
            {() => <EnterprisePage onLeadCapture={() => navigate("/lead-capture")} />}
          </Route>
        </WouterRouter>
      </Suspense>
    );
  }

  if (publicPath.joinTeam) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <JoinTeamPage />
      </Suspense>
    );
  }

  if (publicPath.joinClient) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <JoinClientPage />
      </Suspense>
    );
  }

  if (newUserConfirm) {
    return (
      <NewUserConfirmDialog
        name={newUserConfirm.name}
        email={newUserConfirm.email}
        picture={newUserConfirm.picture}
        setupKey={newUserConfirm.setupKey}
        onConfirmed={handleNewUserConfirmed}
        onCancel={handleNewUserCancelled}
      />
    );
  }

  if (showLeadCapture && !localStorage.getItem("omnianalytix_gate_token")) {
    return (
      <LeadCapturePage
        onBack={() => setShowLeadCapture(false)}
      />
    );
  }

  if (showLanding && !localStorage.getItem("omnianalytix_gate_token") && !hasSsoCallbackParams()) {
    // VIS-01: when an unauthenticated user followed a deep link to a
    // protected route, show a focused sign-in prompt that names the
    // destination, instead of dumping them onto the marketing landing.
    const pendingReturnPath = typeof window !== "undefined"
      ? sessionStorage.getItem("omni_return_path")
      : null;
    if (pendingReturnPath) {
      return (
        <AuthRequiredPrompt
          returnPath={pendingReturnPath}
          onSignIn={startGoogleSso}
          onCancel={() => {
            sessionStorage.removeItem("omni_return_path");
            const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
            window.history.replaceState({}, "", basePath || "/");
            // Force a re-render so the marketing landing takes over.
            navigate("/");
          }}
        />
      );
    }
    return (
      <LandingPage
        onEnter={startGoogleSso}
        onSsoStart={startGoogleSso}
        onLeadCapture={() => setShowLeadCapture(true)}
      />
    );
  }

  return (
    <AuthGate onUnauthenticated={() => setShowLanding(true)}>
      <AuthenticatedApp />
    </AuthGate>
  );
}

export default App;
