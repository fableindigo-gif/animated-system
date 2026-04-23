/**
 * SettingsPage — Replit-style two-panel settings
 * Left sidebar: section navigation
 * Right panel: form content for the active section
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";
import { queryKeys } from "@/lib/query-keys";
import { QueryErrorState } from "@/components/query-error-state";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/contexts/currency-context";
import { useFx } from "@/contexts/fx-context";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsTab =
  | "account" | "personalization" | "security"
  | "workspace" | "notifications" | "budget" | "economics" | "integrations"
  | "fx-overrides" | "ai-quota"
  | "billing" | "members";

interface NotifConfig {
  slackWebhook: string;
  googleChatWebhook: string;
  severities: { critical: boolean; warning: boolean; info: boolean };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserData() {
  return {
    name:       localStorage.getItem("omni_user_name")   || "User",
    email:      localStorage.getItem("omni_user_email")  || "",
    avatar:     localStorage.getItem("omni_user_avatar") || null,
    role:       localStorage.getItem("omni_user_role")   || "member",
    authMethod: localStorage.getItem("omnianalytix_gate_token") ? "google_sso" as const : "password" as const,
  };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  super_admin:   "Super Admin",
  admin:         "Admin",
  agency_owner:  "Agency Owner",
  manager:       "Manager",
  analyst:       "Analyst",
  it:            "IT",
  viewer:        "Viewer",
  member:        "Member",
};

const ROLE_BADGE: Record<string, string> = {
  super_admin:   "bg-violet-50 text-violet-700 border-violet-200",
  admin:         "bg-amber-50 text-amber-700 border-amber-200",
  agency_owner:  "bg-[#e8f0fe] text-[#1a73e8] border-[#c5d8fb]",
  manager:       "bg-emerald-50 text-emerald-700 border-emerald-200",
  analyst:       "bg-sky-50 text-sky-700 border-sky-200",
  it:            "bg-orange-50 text-orange-700 border-orange-200",
  viewer:        "bg-gray-100 text-gray-600 border-gray-200",
  member:        "bg-gray-100 text-gray-600 border-gray-200",
};

// ─── Nav items — grouped by category, like Replit's settings ────────────────

interface NavItem { id: SettingsTab; label: string; icon: string; adminOnly?: boolean; managerPlus?: boolean }
interface NavGroup { id: string; title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    title: "Workspace",
    items: [
      { id: "workspace",     label: "Overview",       icon: "domain",          adminOnly: true },
      { id: "notifications", label: "Notifications",  icon: "notifications",   adminOnly: true },
      { id: "budget",        label: "Budget",         icon: "account_balance", adminOnly: true },
      { id: "economics",     label: "Economics",      icon: "savings",         adminOnly: true },
      { id: "fx-overrides",  label: "Custom exchange rates", icon: "currency_exchange", adminOnly: true },
      { id: "ai-quota",      label: "AI Quota",        icon: "monitoring",      managerPlus: true },
      { id: "integrations",  label: "Integrations",   icon: "extension",       adminOnly: true },
    ],
  },
  {
    id: "account",
    title: "Account",
    items: [
      { id: "billing",       label: "Billing",        icon: "credit_card",     adminOnly: true },
      { id: "members",       label: "Members & seats",icon: "group",           adminOnly: true },
    ],
  },
  {
    id: "user",
    title: "User",
    items: [
      { id: "account",         label: "Profile",         icon: "person" },
      { id: "personalization", label: "Personalization", icon: "palette" },
      { id: "security",        label: "Security",        icon: "shield" },
    ],
  },
];

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function SettingRow({ label, description, htmlFor, children }: {
  label: string; description?: string; htmlFor?: string; children: React.ReactNode;
}) {
  const LabelTag = htmlFor ? "label" : "p";
  return (
    <div className="py-6 border-b border-gray-100 last:border-0">
      <div className="grid md:grid-cols-[1fr_1.4fr] gap-6 items-start">
        <div>
          <LabelTag
            {...(htmlFor ? { htmlFor } : {})}
            className="text-sm font-semibold text-gray-900 cursor-default block"
          >
            {label}
          </LabelTag>
          {description && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{description}</p>}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pb-5 border-b border-gray-200 mb-0">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
    </div>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2",
        checked ? "bg-[#1a73e8]" : "bg-gray-200",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ─── Account tab ─────────────────────────────────────────────────────────────

function AccountTab() {
  const user = getUserData();

  return (
    <div className="space-y-0">
      <SectionTitle title="Account" description="Manage your personal information and authentication." />

      {/* Avatar + name header */}
      <div className="py-8 border-b border-gray-100 flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-[#1a73e8] text-white flex items-center justify-center text-xl font-bold overflow-hidden shrink-0">
          {user.avatar
            ? <img src={user.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            : getInitials(user.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-900 truncate">{user.name}</p>
          <p className="text-sm text-gray-500 truncate">{user.email || "No email on file"}</p>
          <span className={cn(
            "inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[11px] font-semibold border",
            ROLE_BADGE[user.role] ?? "bg-gray-100 text-gray-600 border-gray-200",
          )}>
            <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
            {ROLE_LABELS[user.role] ?? user.role}
          </span>
        </div>
      </div>

      <SettingRow label="Full name" description="Your display name across the platform." htmlFor="account-full-name">
        <input
          id="account-full-name"
          type="text"
          readOnly
          defaultValue={user.name}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-gray-50 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-2"
        />
      </SettingRow>

      <SettingRow label="Email address" description="Used for notifications and login." htmlFor="account-email">
        <input
          id="account-email"
          type="email"
          readOnly
          defaultValue={user.email}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-gray-50 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-2 font-mono"
        />
      </SettingRow>

      <SettingRow label="Authentication method" description="How you sign in to OmniAnalytix.">
        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-white">
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Google Single Sign-On</p>
            <p className="text-xs text-gray-500">Authenticated via Google Workspace</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        </div>
      </SettingRow>
    </div>
  );
}

// ─── Workspace tab ────────────────────────────────────────────────────────────

function WorkspaceTab() {
  const { activeWorkspace } = useWorkspace();

  const GOAL_OPTIONS = [
    { value: "ecom",    label: "E-Commerce",       desc: "Shopify + Google Ads + Meta" },
    { value: "leadgen", label: "Lead Generation",  desc: "CRM + paid search funnels" },
    { value: "hybrid",  label: "Hybrid",           desc: "Multi-objective campaigns" },
  ];

  return (
    <div className="space-y-0">
      <SectionTitle title="Workspace" description="Client workspace details and configuration." />

      <SettingRow label="Client name" description="The name of this client or brand workspace." htmlFor="workspace-client-name">
        <input
          id="workspace-client-name"
          type="text"
          readOnly
          defaultValue={activeWorkspace?.clientName ?? "—"}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-gray-50 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-2"
        />
      </SettingRow>

      <SettingRow label="Workspace ID" description="Unique identifier used in API calls." htmlFor="workspace-id">
        <input
          id="workspace-id"
          type="text"
          readOnly
          defaultValue={activeWorkspace?.id ?? "—"}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-2 font-mono"
        />
      </SettingRow>

      <SettingRow label="Primary goal" description="Controls which analytics views and AI models are active.">
        <div className="space-y-2">
          {GOAL_OPTIONS.map((g) => {
            const active = (activeWorkspace?.primaryGoal ?? "ecom") === g.value;
            return (
              <div
                key={g.value}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  active ? "border-[#1a73e8] bg-[#e8f0fe]" : "border-gray-200 bg-white",
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                  active ? "border-[#1a73e8]" : "border-gray-300",
                )}>
                  {active && <div className="w-2 h-2 rounded-full bg-[#1a73e8]" />}
                </div>
                <div>
                  <p className={cn("text-sm font-medium", active ? "text-[#1a73e8]" : "text-gray-900")}>{g.label}</p>
                  <p className="text-xs text-gray-500">{g.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-2">Contact your admin to change the workspace goal.</p>
      </SettingRow>
    </div>
  );
}

// ─── Notifications tab ────────────────────────────────────────────────────────

function NotificationsTab() {
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();
  const { toast } = useToast();

  const [notif, setNotif] = useState<NotifConfig>(() => {
    const saved = localStorage.getItem("omni_notif_config");
    if (saved) return JSON.parse(saved);
    return { slackWebhook: "", googleChatWebhook: "", severities: { critical: true, warning: true, info: false } };
  });
  const [webhookUrl, setWebhookUrl] = useState(activeWorkspace?.webhookUrl ?? "");
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  useEffect(() => { setWebhookUrl(activeWorkspace?.webhookUrl ?? ""); }, [activeWorkspace?.webhookUrl]);

  async function handleSave() {
    setSaving(true);
    try {
      localStorage.setItem("omni_notif_config", JSON.stringify(notif));
    } catch (err) {
      // Safari Private Mode and quota-exceeded throw on localStorage writes.
      // The webhook still saves to the server below; only the local notif
      // preferences are lost. Surface a soft warning instead of crashing.
      console.warn("[workspace-settings] Could not persist notification config locally:", err);
    }
    if (activeWorkspace && webhookUrl !== (activeWorkspace.webhookUrl ?? "")) {
      try {
        const res = await authFetch(`${API_BASE}api/workspaces/${activeWorkspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ webhookUrl: webhookUrl || null }),
        });
        if (!res.ok) throw new Error("non-ok");
        refreshWorkspaces();
      } catch {
        setSaving(false);
        toast({ title: "Save Failed", description: "Could not update webhook configuration.", variant: "destructive" });
        return;
      }
    }
    setTimeout(() => {
      setSaving(false); setSaved(true);
      toast({ title: "Notifications saved" });
      setTimeout(() => setSaved(false), 2500);
    }, 350);
  }

  const severityMeta = {
    critical: { label: "Critical",   color: "text-red-600",    bg: "bg-red-500" },
    warning:  { label: "Warning",    color: "text-amber-600",  bg: "bg-amber-500" },
    info:     { label: "Info",       color: "text-blue-600",   bg: "bg-blue-500" },
  } as const;

  return (
    <div className="space-y-0">
      <SectionTitle title="Notifications" description="Configure where AI alerts and system events are sent." />

      <SettingRow label="Slack webhook" description="Paste your Slack incoming webhook URL to receive AI-generated alerts in a Slack channel.">
        <input
          type="url"
          value={notif.slackWebhook}
          onChange={(e) => setNotif((p) => ({ ...p, slackWebhook: e.target.value }))}
          placeholder="https://hooks.slack.com/services/..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono"
        />
      </SettingRow>

      <SettingRow label="Google Chat webhook" description="Forward alerts to a Google Chat Space via an incoming webhook.">
        <input
          type="url"
          value={notif.googleChatWebhook}
          onChange={(e) => setNotif((p) => ({ ...p, googleChatWebhook: e.target.value }))}
          placeholder="https://chat.googleapis.com/v1/spaces/..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono"
        />
      </SettingRow>

      <SettingRow
        label="Alert severities"
        description="Choose which severity levels trigger a notification."
      >
        <div className="space-y-3">
          {(["critical", "warning", "info"] as const).map((sev) => {
            const m = severityMeta[sev];
            const on = notif.severities[sev];
            return (
              <div key={sev} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", m.bg)} />
                  <span className={cn("text-sm font-medium", on ? "text-gray-900" : "text-gray-400")}>{m.label}</span>
                </div>
                <Toggle
                  checked={on}
                  onChange={(v) => setNotif((p) => ({ ...p, severities: { ...p.severities, [sev]: v } }))}
                />
              </div>
            );
          })}
        </div>
      </SettingRow>

      <div className="pt-5">
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
            saved
              ? "bg-emerald-600 text-white"
              : "bg-[#1a73e8] hover:bg-[#1557b0] text-white disabled:opacity-50",
          )}
        >
          {saved ? (
            <><span className="material-symbols-outlined text-sm">check</span>Saved</>
          ) : saving ? (
            <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>Saving…</>
          ) : (
            "Save notifications"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Budget tab ───────────────────────────────────────────────────────────────

// ─── Economics tab (Task #153) ───────────────────────────────────────────────
// Per-tenant COGS % and target ROAS. Used by the dashboard True Profit /
// POAS tiles, the profit trend chart, and the performance-grid Health badge.
// Per-campaign target ROAS overrides are stored on the same backing table
// but edited inline on the performance grid, not here.

interface EconomicsPayload {
  cogsPct:           number | null;
  targetRoas:        number | null;
  campaignOverrides: Record<string, number>;
}

function EconomicsTab() {
  const { toast } = useToast();
  const [cogsPctInput, setCogsPctInput]       = useState("");
  const [targetRoasInput, setTargetRoasInput] = useState("");
  const [overrideCount, setOverrideCount]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // Economics settings are loaded via react-query so navigating away mid-fetch
  // can't trigger a "set state on unmounted" warning, and re-entering the tab
  // hits the cache instead of re-fetching.
  const economicsQuery = useQuery({
    queryKey: queryKeys.economicsSettings(),
    queryFn: async () => {
      const res = await authFetch(`${API_BASE}api/settings/economics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as EconomicsPayload;
    },
  });
  useEffect(() => {
    if (!economicsQuery.data) return;
    const data = economicsQuery.data;
    // Show COGS as percentage (35) not fraction (0.35) — friendlier for humans.
    setCogsPctInput(data.cogsPct == null ? "" : (data.cogsPct * 100).toFixed(1).replace(/\.0$/, ""));
    setTargetRoasInput(data.targetRoas == null ? "" : data.targetRoas.toString());
    setOverrideCount(Object.keys(data.campaignOverrides ?? {}).length);
  }, [economicsQuery.data]);
  useEffect(() => {
    if (economicsQuery.isError) toast({ title: "Failed to load economics", variant: "destructive" });
  }, [economicsQuery.isError, toast]);
  useEffect(() => { setLoading(economicsQuery.isLoading); }, [economicsQuery.isLoading]);

  async function handleSave() {
    // Empty fields explicitly clear the override (null) so the dashboard
    // falls back to its built-in defaults again.
    const cogsRaw = cogsPctInput.trim();
    const roasRaw = targetRoasInput.trim();

    let cogsPct: number | null = null;
    if (cogsRaw !== "") {
      const n = Number(cogsRaw);
      if (!Number.isFinite(n) || n < 0 || n >= 95) {
        toast({ title: "Invalid COGS %", description: "Enter a number between 0 and 95.", variant: "destructive" });
        return;
      }
      cogsPct = n / 100;
    }

    let targetRoas: number | null = null;
    if (roasRaw !== "") {
      const n = Number(roasRaw);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        toast({ title: "Invalid target ROAS", description: "Enter a positive multiplier (e.g. 4 for 4x).", variant: "destructive" });
        return;
      }
      targetRoas = n;
    }

    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}api/settings/economics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cogsPct, targetRoas }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Economics saved", description: "Dashboard tiles will reflect the new values shortly." });
    } catch {
      toast({ title: "Failed to save economics", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-0">
      <SectionTitle
        title="Economics"
        description="Per-tenant defaults for True Profit, POAS, and the campaign Health badge. Leave blank to use the platform defaults (35% COGS, 4× target ROAS)."
      />

      {economicsQuery.isError && (
        <div className="px-4 pt-2">
          <QueryErrorState
            title="Couldn't load economics settings"
            error={economicsQuery.error}
            onRetry={() => economicsQuery.refetch()}
            compact
          />
        </div>
      )}

      <SettingRow
        label="Default COGS %"
        description="Cost of goods sold as a percentage of revenue. Used to compute True Profit and POAS on every dashboard tile."
        htmlFor="economics-cogs-pct"
      >
        <div className="relative max-w-[12rem]">
          <input
            id="economics-cogs-pct"
            type="text"
            inputMode="decimal"
            value={cogsPctInput}
            onChange={(e) => setCogsPctInput(e.target.value)}
            disabled={loading}
            placeholder="35"
            className="w-full border border-gray-300 rounded-lg pl-3 pr-7 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 select-none pointer-events-none">%</span>
        </div>
      </SettingRow>

      <SettingRow
        label="Default target ROAS"
        description="Revenue per dollar of ad spend you're aiming for. The campaign Health badge scores each campaign as a percentage of this target."
        htmlFor="economics-target-roas"
      >
        <div className="relative max-w-[12rem]">
          <input
            id="economics-target-roas"
            type="text"
            inputMode="decimal"
            value={targetRoasInput}
            onChange={(e) => setTargetRoasInput(e.target.value)}
            disabled={loading}
            placeholder="4"
            className="w-full border border-gray-300 rounded-lg pl-3 pr-7 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 select-none pointer-events-none">×</span>
        </div>
      </SettingRow>

      {overrideCount > 0 && (
        <SettingRow label="Per-campaign overrides">
          <p className="text-sm text-gray-600">
            {overrideCount} campaign{overrideCount === 1 ? "" : "s"} override the default target ROAS.
          </p>
        </SettingRow>
      )}

      <div className="pt-5">
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors bg-[#1a73e8] hover:bg-[#1557b0] text-white disabled:opacity-50"
        >
          {saving ? (
            <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>Saving…</>
          ) : (
            "Save economics"
          )}
        </button>
      </div>
    </div>
  );
}

function BudgetTab() {
  const { toast }            = useToast();
  const { currencySymbol }   = useCurrency();

  const [budgetTarget, setBudgetTarget] = useState(() =>
    localStorage.getItem("omni_monthly_budget_target") || ""
  );
  const [budgetSaved, setBudgetSaved] = useState(!!localStorage.getItem("omni_monthly_budget_target"));
  const [saving, setSaving]           = useState(false);

  function handleSave() {
    const val = budgetTarget.replace(/[^0-9.]/g, "");
    if (!val || parseFloat(val) <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive monthly budget.", variant: "destructive" });
      return;
    }
    setSaving(true);
    setTimeout(() => {
      localStorage.setItem("omni_monthly_budget_target", val);
      setBudgetSaved(true);
      setSaving(false);
      toast({ title: "Budget target saved", description: `Ceiling set to ${currencySymbol}${Number(val).toLocaleString()}` });
    }, 300);
  }

  return (
    <div className="space-y-0">
      <SectionTitle title="Budget" description="Set cross-platform spend limits for pacing and overspend alerts." />

      <SettingRow
        label="Monthly spend ceiling"
        description="Maximum total ad spend across all connected platforms. The pacing engine and overspend detection use this target."
      >
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 font-medium select-none pointer-events-none">
              {currencySymbol}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={budgetTarget}
              onChange={(e) => { setBudgetTarget(e.target.value); setBudgetSaved(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="50,000"
              className="w-full border border-gray-300 rounded-lg pl-6 pr-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono"
            />
          </div>

          {budgetSaved && budgetTarget && (
            <p className="text-sm text-emerald-600 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Ceiling: {currencySymbol}{Number(budgetTarget.replace(/[^0-9.]/g, "")).toLocaleString()} — pacing active
            </p>
          )}
        </div>
      </SettingRow>

      <div className="pt-5">
        <button
          onClick={handleSave}
          disabled={!budgetTarget.trim() || saving}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
            budgetSaved
              ? "bg-emerald-600 text-white"
              : "bg-[#1a73e8] hover:bg-[#1557b0] text-white disabled:opacity-50",
          )}
        >
          {saving ? (
            <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>Saving…</>
          ) : budgetSaved ? (
            <><span className="material-symbols-outlined text-sm">check</span>Saved</>
          ) : (
            "Save budget"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Custom exchange rates (FX overrides) tab ────────────────────────────────

interface FxOverrideRow {
  id:          number;
  workspaceId: number;
  base:        string;
  quote:       string;
  rate:        number;
  note:        string | null;
  createdAt?:  string;
  updatedAt?:  string;
}

const COMMON_QUOTES = ["INR", "GBP", "EUR", "CAD", "AUD", "JPY", "MXN", "BRL", "SGD", "ZAR"];

function FxOverridesTab() {
  const { activeWorkspace } = useWorkspace();
  const { invalidateCache } = useFx();
  const { toast }           = useToast();
  const workspaceId         = activeWorkspace?.id ?? null;

  const [rows, setRows]       = useState<FxOverrideRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Form state for add/edit. `editingQuote` is null when adding fresh.
  const [editingQuote, setEditingQuote] = useState<string | null>(null);
  const [formQuote, setFormQuote]       = useState("");
  const [formRate, setFormRate]         = useState("");
  const [formNote, setFormNote]         = useState("");
  const [saving, setSaving]             = useState(false);

  function resetForm() {
    setEditingQuote(null);
    setFormQuote("");
    setFormRate("");
    setFormNote("");
  }

  async function loadRows() {
    if (workspaceId == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}api/fx/overrides?workspaceId=${workspaceId}`);
      if (!res.ok) {
        if (res.status === 403) {
          setError("You don't have permission to view custom exchange rates for this workspace.");
        } else {
          setError(`Failed to load overrides (HTTP ${res.status}).`);
        }
        setRows([]);
        return;
      }
      const json = await res.json() as { ok?: boolean; overrides?: FxOverrideRow[] };
      setRows(Array.isArray(json.overrides) ? json.overrides : []);
    } catch {
      setError("Network error while loading overrides.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Whenever the active workspace changes, reset any in-progress edit so we
    // don't accidentally save form values from workspace A into workspace B.
    resetForm();
    void loadRows();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [workspaceId]);

  function startEdit(row: FxOverrideRow) {
    setEditingQuote(row.quote);
    setFormQuote(row.quote);
    setFormRate(String(row.rate));
    setFormNote(row.note ?? "");
  }

  async function handleSave() {
    if (workspaceId == null) return;
    const quote = formQuote.trim().toUpperCase();
    const rateNum = Number(formRate);
    if (!/^[A-Z]{3}$/.test(quote)) {
      toast({ title: "Invalid currency", description: "Use a 3-letter ISO code (e.g. INR, GBP).", variant: "destructive" });
      return;
    }
    if (quote === "USD") {
      toast({ title: "Invalid currency", description: "USD is the base — overrides target a different currency.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      toast({ title: "Invalid rate", description: "Rate must be a positive number.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}api/fx/overrides`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          workspaceId,
          base:  "USD",
          quote,
          rate:  rateNum,
          note:  formNote.trim() || null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        toast({
          title: "Save failed",
          description: txt || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: editingQuote ? "Override updated" : "Override added", description: `USD → ${quote} pinned at ${rateNum}.` });
      resetForm();
      await loadRows();
      invalidateCache();
    } catch {
      toast({ title: "Save failed", description: "Network error — please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(quote: string) {
    if (workspaceId == null) return;
    if (!window.confirm(`Remove the custom rate for USD → ${quote}? Dashboards will revert to the daily provider rate.`)) return;
    try {
      const res = await authFetch(
        `${API_BASE}api/fx/overrides?workspaceId=${workspaceId}&quote=${encodeURIComponent(quote)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast({ title: "Delete failed", description: `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      toast({ title: "Override removed", description: `USD → ${quote} now uses the daily provider rate.` });
      if (editingQuote === quote) resetForm();
      await loadRows();
      invalidateCache();
    } catch {
      toast({ title: "Delete failed", description: "Network error — please try again.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-0">
      <SectionTitle
        title="Custom exchange rates"
        description="Pin a fixed USD-to-currency rate that supersedes the daily provider value across all dashboards. Useful when finance has closed the books at a known month-end rate."
      />

      <SettingRow
        label={editingQuote ? `Edit override: USD → ${editingQuote}` : "Add an override"}
        description="Rate is the number of target-currency units per 1 USD (e.g. 83.25 means 1 USD = 83.25 INR)."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Quote</label>
              <input
                list="fx-quote-suggestions"
                type="text"
                maxLength={3}
                value={formQuote}
                onChange={(e) => setFormQuote(e.target.value.toUpperCase())}
                disabled={!!editingQuote}
                placeholder="INR"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono uppercase disabled:bg-gray-50 disabled:text-gray-500"
              />
              <datalist id="fx-quote-suggestions">
                {COMMON_QUOTES.map((q) => <option key={q} value={q} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Rate (per 1 USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={formRate}
                onChange={(e) => setFormRate(e.target.value)}
                placeholder="83.25"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Note (optional)</label>
            <input
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. Q1 close — finance pinned rate"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !formQuote.trim() || !formRate.trim() || workspaceId == null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white transition-colors disabled:opacity-50"
            >
              {saving ? (
                <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>Saving…</>
              ) : editingQuote ? (
                <><span className="material-symbols-outlined text-sm">save</span>Save changes</>
              ) : (
                <><span className="material-symbols-outlined text-sm">add</span>Add override</>
              )}
            </button>
            {editingQuote && (
              <button
                onClick={resetForm}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </SettingRow>

      <SettingRow
        label="Active overrides"
        description={
          rows.length === 0
            ? "No custom rates pinned — dashboards use the daily provider rate."
            : `${rows.length} pinned ${rows.length === 1 ? "rate" : "rates"} active for this workspace.`
        }
      >
        {workspaceId == null ? (
          <p className="text-sm text-gray-500">Select a workspace to manage overrides.</p>
        ) : loading ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            Loading…
          </p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing here yet — add your first override above.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wider">Pair</th>
                  <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wider">Rate</th>
                  <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wider">Note</th>
                  <th className="px-3 py-2 w-1"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono font-semibold text-gray-900">
                      {row.base} → {row.quote}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900">{row.rate}</td>
                    <td className="px-3 py-2 text-gray-600 truncate max-w-[220px]" title={row.note ?? ""}>
                      {row.note || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(row)}
                          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                          title="Edit"
                          aria-label={`Edit USD to ${row.quote}`}
                        >
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(row.quote)}
                          className="p-1.5 rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Delete"
                          aria-label={`Delete USD to ${row.quote}`}
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingRow>
    </div>
  );
}

// ─── Security tab ─────────────────────────────────────────────────────────────

function SecurityTab() {
  function handleSignOut() {
    [
      "omnianalytix_gate_token", "omni_current_user_id", "omni_user_name",
      "omni_user_email", "omni_user_avatar", "omni_user_role", "omni_preauth_done",
    ].forEach((k) => localStorage.removeItem(k));
    window.location.href = import.meta.env.BASE_URL || "/";
  }

  return (
    <div className="space-y-0">
      <SectionTitle title="Security" description="Session management and account access controls." />

      <SettingRow label="Active session" description="Your current authenticated session details.">
        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-white">
          <span className="material-symbols-outlined text-gray-400 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>key</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Session active</p>
            <p className="text-xs text-gray-500">Managed by Google SSO — no manual rotation required</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        </div>
      </SettingRow>

      <SettingRow label="Two-factor authentication" description="Additional verification layer for account access.">
        <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg bg-white">
          <div>
            <p className="text-sm font-medium text-gray-700">Enforced via Google Workspace</p>
            <p className="text-xs text-gray-500 mt-0.5">Managed by your organization's SSO policy</p>
          </div>
          <span className="text-xs font-semibold text-gray-400 border border-gray-200 rounded-md px-2 py-0.5">SSO-managed</span>
        </div>
      </SettingRow>

      <div className="py-6 border-t border-gray-200 mt-4">
        <p className="text-sm font-semibold text-gray-900 mb-1">Danger zone</p>
        <p className="text-sm text-gray-500 mb-4">Sign out of OmniAnalytix on this device.</p>
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">logout</span>
          Sign out
        </button>
      </div>
    </div>
  );
}

// ─── Personalization tab ──────────────────────────────────────────────────────

function PersonalizationTab() {
  const [theme, setTheme]       = useState(() => localStorage.getItem("omni_theme") || "light");
  const [density, setDensity]   = useState(() => localStorage.getItem("omni_density") || "comfortable");
  const { toast } = useToast();

  function persist(key: string, value: string, label: string) {
    try {
      localStorage.setItem(key, value);
      toast({ title: `${label} updated` });
    } catch (err) {
      // Safari Private Mode / quota-exceeded throw here. Without try/catch
      // the whole settings page would crash. Tell the user instead.
      console.warn("[workspace-settings] localStorage write failed:", err);
      toast({
        title: `Could not save ${label.toLowerCase()}`,
        description: "Your browser is blocking local storage. Try a normal (non-private) window.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-0">
      <SectionTitle title="Personalization" description="Adjust the look and feel of OmniAnalytix on this device." />

      <SettingRow label="Theme" description="Light theme is currently the default. Dark mode coming soon.">
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: "light",  label: "Light",  bg: "bg-white border-gray-300" },
            { v: "dark",   label: "Dark",   bg: "bg-gray-900 border-gray-700" },
            { v: "system", label: "System", bg: "bg-gradient-to-br from-white to-gray-900 border-gray-300" },
          ].map((opt) => (
            <button
              key={opt.v}
              onClick={() => { setTheme(opt.v); persist("omni_theme", opt.v, "Theme"); }}
              className={cn(
                "p-3 rounded-lg border-2 text-left transition-all",
                theme === opt.v ? "border-[#1a73e8] ring-2 ring-[#1a73e8]/20" : "border-gray-200 hover:border-gray-300",
              )}
            >
              <div className={cn("h-12 w-full rounded mb-2 border", opt.bg)} />
              <p className="text-xs font-semibold text-gray-900">{opt.label}</p>
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Density" description="How tightly information is packed in tables and lists.">
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: "comfortable", label: "Comfortable" },
            { v: "compact",     label: "Compact" },
          ].map((opt) => (
            <button
              key={opt.v}
              onClick={() => { setDensity(opt.v); persist("omni_density", opt.v, "Density"); }}
              className={cn(
                "p-3 rounded-lg border text-sm font-medium transition-colors",
                density === opt.v
                  ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Language" description="Display language for the OmniAnalytix interface.">
        <select
          defaultValue="en"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none"
        >
          <option value="en">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </SettingRow>
    </div>
  );
}

// ─── AI Quota tab ─────────────────────────────────────────────────────────────

const WARN_THRESHOLD = 0.8;

interface DailyUsageRow {
  date:        string;
  rowsRead:    number;
  queryCount:  number;
  capPct:      number;
  dailyRowCap: number;
}

interface AiUsagePayload {
  guardrails: { maxLookbackDays: number; dailyRowCap: number };
  usage: DailyUsageRow[];
}

interface AiGuardrailsPayload {
  maxLookbackDays: number;
  dailyRowCap:     number;
  defaults?:       { maxLookbackDays: number; dailyRowCap: number };
}

function UsageSparkline({ rows, cap }: { rows: DailyUsageRow[]; cap: number }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400 italic">No usage data yet.</p>;

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const W = 320, H = 56, PAD = 4;
  const maxVal = Math.max(cap, ...sorted.map((r) => r.rowsRead));
  const pts = sorted.map((r, i) => {
    const x = PAD + (i / Math.max(sorted.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - (r.rowsRead / maxVal) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const warnY = H - PAD - (cap * WARN_THRESHOLD / maxVal) * (H - PAD * 2);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }} aria-label="Daily AI row usage sparkline">
        <line x1={PAD} y1={warnY} x2={W - PAD} y2={warnY} stroke="#f59e0b" strokeDasharray="3,3" strokeWidth="1" opacity="0.7" />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="#1a73e8"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {sorted.map((r, i) => {
          const x = PAD + (i / Math.max(sorted.length - 1, 1)) * (W - PAD * 2);
          const y = H - PAD - (r.rowsRead / maxVal) * (H - PAD * 2);
          const over = r.rowsRead / cap >= WARN_THRESHOLD;
          return <circle key={r.date} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.5" fill={over ? "#f59e0b" : "#1a73e8"} />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{sorted[0]?.date}</span>
        <span className="text-amber-500">── 80 % warn threshold</span>
        <span>{sorted[sorted.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function AiQuotaTab() {
  const { toast } = useToast();

  const [usageData,    setUsageData]    = useState<AiUsagePayload | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [loadErr,      setLoadErr]      = useState(false);

  const [lookbackInput, setLookbackInput] = useState("");
  const [rowCapInput,   setRowCapInput]   = useState("");
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [usageRes, guardrailsRes] = await Promise.all([
          authFetch(`${API_BASE}api/system/ai-gads-usage?days=30`),
          authFetch(`${API_BASE}api/settings/ai-guardrails`),
        ]);
        if (!usageRes.ok || !guardrailsRes.ok) throw new Error("non-ok");
        const usage      = (await usageRes.json())      as AiUsagePayload;
        const guardrails = (await guardrailsRes.json()) as AiGuardrailsPayload;
        if (!alive) return;
        setUsageData(usage);
        setLookbackInput(String(guardrails.maxLookbackDays));
        setRowCapInput(String(guardrails.dailyRowCap));
      } catch {
        if (alive) setLoadErr(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const todayDate = new Date().toISOString().slice(0, 10);
  const todayRow  = usageData?.usage?.find((r) => r.date === todayDate) ?? null;
  const todayRows = todayRow?.rowsRead ?? 0;
  const cap       = usageData?.guardrails?.dailyRowCap ?? 50_000;
  const fraction  = Math.min(todayRows / cap, 1);
  const isWarn    = fraction >= WARN_THRESHOLD;
  const isCapped  = fraction >= 1;

  async function handleSave() {
    const lookback = parseInt(lookbackInput, 10);
    const rowCap   = parseInt(rowCapInput, 10);
    if (!Number.isInteger(lookback) || lookback < 1 || lookback > 365) {
      toast({ title: "Invalid lookback", description: "Must be between 1 and 365 days.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(rowCap) || rowCap < 100 || rowCap > 1_000_000) {
      toast({ title: "Invalid daily row cap", description: "Must be between 100 and 1,000,000.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}api/settings/ai-guardrails`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxLookbackDays: lookback, dailyRowCap: rowCap }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "AI guardrails saved", description: "The new caps apply to all future AI queries." });
      if (usageData) {
        setUsageData((prev) => prev
          ? { ...prev, guardrails: { maxLookbackDays: lookback, dailyRowCap: rowCap } }
          : prev,
        );
      }
    } catch {
      toast({ title: "Failed to save guardrails", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-0">
        <SectionTitle title="AI Quota" description="Monitor and control how many Google Ads rows the AI reads each day." />
        <div className="py-12 flex items-center justify-center gap-2 text-sm text-gray-400">
          <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
          Loading usage data…
        </div>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="space-y-0">
        <SectionTitle title="AI Quota" description="Monitor and control how many Google Ads rows the AI reads each day." />
        <div className="py-10 text-center text-sm text-red-500">Failed to load AI usage data. Please try again.</div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <SectionTitle
        title="AI Quota"
        description="Monitor and control how many Google Ads rows the AI reads each day. Limits apply per workspace."
      />

      {/* ── Today's usage gauge ─────────────────────────────────────────── */}
      <SettingRow
        label="Today's usage"
        description="Rows read by AI queries today versus the daily cap."
      >
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gray-900 tabular-nums">
              {todayRows.toLocaleString()}
            </span>
            <span className="text-sm text-gray-500">
              of {cap.toLocaleString()} rows
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isCapped ? "bg-red-500" : isWarn ? "bg-amber-400" : "bg-[#1a73e8]",
              )}
              style={{ width: `${(fraction * 100).toFixed(1)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{(fraction * 100).toFixed(1)}% of daily cap used</span>
            {isCapped && (
              <span className="flex items-center gap-1 text-red-600 font-semibold">
                <span className="material-symbols-outlined text-sm">block</span>
                Cap reached — AI queries blocked
              </span>
            )}
            {!isCapped && isWarn && (
              <span className="flex items-center gap-1 text-amber-600 font-semibold">
                <span className="material-symbols-outlined text-sm">warning</span>
                Nearing daily cap
              </span>
            )}
          </div>
        </div>
      </SettingRow>

      {/* ── Last 30 days sparkline ──────────────────────────────────────── */}
      <SettingRow
        label="30-day trend"
        description="Daily rows read over the last 30 days. Amber dots indicate days that hit the 80% warning threshold."
      >
        <UsageSparkline rows={usageData?.usage ?? []} cap={cap} />
      </SettingRow>

      {/* ── Recent usage table ──────────────────────────────────────────── */}
      <SettingRow
        label="Recent days"
        description="Detailed breakdown of AI Google Ads row consumption."
      >
        {(usageData?.usage?.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-400 italic">No usage recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Date</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Rows read</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Queries</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">% of cap</th>
                </tr>
              </thead>
              <tbody>
                {(usageData?.usage ?? []).slice(0, 30).map((row) => {
                  const pct = row.capPct;
                  const warn = pct >= WARN_THRESHOLD * 100;
                  return (
                    <tr key={row.date} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-700">{row.date}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">{row.rowsRead.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{row.queryCount}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", warn ? "text-amber-600" : "text-gray-600")}>
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingRow>

      {/* ── Guardrail config ────────────────────────────────────────────── */}
      <SettingRow
        label="Max lookback days"
        description="How far back AI queries can scan Google Ads history (1–365 days). Reducing this limits data retrieved per query."
        htmlFor="ai-quota-lookback"
      >
        <div className="flex items-center gap-2 max-w-[10rem]">
          <input
            id="ai-quota-lookback"
            type="number"
            min={1}
            max={365}
            value={lookbackInput}
            onChange={(e) => setLookbackInput(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors font-mono"
          />
          <span className="text-sm text-gray-500 shrink-0">days</span>
        </div>
      </SettingRow>

      <SettingRow
        label="Daily row cap"
        description="Maximum Google Ads rows the AI may read per day across all queries (100–1,000,000). AI queries are blocked once this is reached."
        htmlFor="ai-quota-row-cap"
      >
        <div className="flex items-center gap-2 max-w-[14rem]">
          <input
            id="ai-quota-row-cap"
            type="number"
            min={100}
            max={1_000_000}
            step={1000}
            value={rowCapInput}
            onChange={(e) => setRowCapInput(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none transition-colors font-mono"
          />
          <span className="text-sm text-gray-500 shrink-0">rows</span>
        </div>
      </SettingRow>

      <div className="pt-5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>Saving…</>
          ) : (
            "Save guardrails"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Integrations tab — links to dedicated /connections page ─────────────────

function IntegrationsTab() {
  const [, navigate] = useLocation();
  return (
    <div className="space-y-0">
      <SectionTitle title="Integrations" description="Connect Shopify, Google Ads, Meta, GA4, and more to power AI analytics." />

      <SettingRow
        label="Manage connections"
        description="OmniAnalytix integrates with 30+ platforms via OAuth or API keys. The full integration manager lets you add, refresh, and revoke connections."
      >
        <button
          onClick={() => navigate("/connections")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white transition-colors"
        >
          <span className="material-symbols-outlined text-sm">open_in_new</span>
          Open integration manager
        </button>
      </SettingRow>

      <SettingRow
        label="Webhook routing"
        description="Server-to-server events for downstream automation (Zapier, Make, n8n, custom endpoints)."
      >
        <input
          type="url"
          placeholder="https://hooks.example.com/omni-events"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-[#1a73e8] focus:border-[#1a73e8] outline-none placeholder:text-gray-400 font-mono"
        />
      </SettingRow>
    </div>
  );
}

// ─── Billing tab — links to dedicated billing hub ────────────────────────────

function BillingTab() {
  const [, navigate] = useLocation();
  return (
    <div className="space-y-0">
      <SectionTitle title="Billing" description="Subscription, payment methods, and invoices." />

      <SettingRow
        label="Current plan"
        description="Your active OmniAnalytix subscription tier."
      >
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
          <div>
            <p className="text-sm font-semibold text-gray-900">OmniAnalytix Pro</p>
            <p className="text-xs text-gray-500 mt-0.5">$299 / month • Renews monthly</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200">
            Active
          </span>
        </div>
      </SettingRow>

      <SettingRow label="Manage billing" description="View invoices, change payment method, or upgrade your plan.">
        <button
          onClick={() => navigate("/billing-hub")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white transition-colors"
        >
          <span className="material-symbols-outlined text-sm">open_in_new</span>
          Open billing hub
        </button>
      </SettingRow>
    </div>
  );
}

// ─── Members tab — links to client admin ─────────────────────────────────────

function MembersTab() {
  const [, navigate] = useLocation();
  return (
    <div className="space-y-0">
      <SectionTitle title="Members & seats" description="Invite teammates, assign roles, and track seat usage." />

      <SettingRow
        label="Manage members"
        description="Add or remove team members, change roles, and configure permissions per workspace."
      >
        <button
          onClick={() => navigate("/admin/clients")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white transition-colors"
        >
          <span className="material-symbols-outlined text-sm">open_in_new</span>
          Open admin panel
        </button>
      </SettingRow>

      <SettingRow label="Available roles" description="Replit-style RBAC with granular permission tiers.">
        <div className="space-y-1.5">
          {[
            { role: "Agency owner",    desc: "Full control across all client workspaces" },
            { role: "Admin",           desc: "Workspace admin: settings, billing, members" },
            { role: "Manager",         desc: "Read-write access to campaigns and reports" },
            { role: "Analyst",         desc: "Run reports and queries; no edit access" },
            { role: "Viewer",          desc: "Read-only access to dashboards" },
          ].map((r) => (
            <div key={r.role} className="flex items-baseline gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
              <span className="font-semibold text-gray-900 w-32 shrink-0">{r.role}</span>
              <span className="text-gray-500 text-xs">{r.desc}</span>
            </div>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

// ─── Workspace selector — top of left nav ────────────────────────────────────

function WorkspaceSelector() {
  const { activeWorkspace, workspaces, switchWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);

  if (!activeWorkspace) return null;

  return (
    <div className="relative px-3 mb-4">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="w-6 h-6 rounded-md bg-[#1a73e8] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
          {activeWorkspace.clientName.slice(0, 2).toUpperCase()}
        </div>
        <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{activeWorkspace.clientName}</span>
        <span className="material-symbols-outlined text-gray-400 text-base shrink-0">unfold_more</span>
      </button>

      {open && workspaces.length > 1 && (
        <div className="absolute top-full left-3 right-3 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto py-1">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => { switchWorkspace(w.id); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors",
                w.id === activeWorkspace.id ? "bg-[#e8f0fe] text-[#1a73e8] font-semibold" : "text-gray-700 hover:bg-gray-50",
              )}
            >
              <div className="w-5 h-5 rounded-md bg-gray-200 text-gray-700 text-[9px] font-bold flex items-center justify-center shrink-0">
                {w.clientName.slice(0, 2).toUpperCase()}
              </div>
              <span className="truncate">{w.clientName}</span>
              {w.id === activeWorkspace.id && <span className="material-symbols-outlined text-sm ml-auto">check</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

// All valid tab IDs — used to validate the ?tab= URL search param.
const ALL_TABS: SettingsTab[] = [
  "account", "personalization", "security",
  "workspace", "notifications", "budget", "economics",
  "integrations", "fx-overrides", "ai-quota", "billing", "members",
];

export default function SettingsPage({ defaultTab = "account" }: { defaultTab?: SettingsTab }) {
  const user              = getUserData();
  const isAdmin           = ["admin", "agency_owner", "super_admin"].includes(user.role);
  const isManagerOrAbove  = ["manager", "admin", "agency_owner", "super_admin"].includes(user.role);
  const [, navigate]      = useLocation();

  // Support deep-linking from dashboard tiles: e.g. /settings?tab=economics
  const urlTab = (() => {
    const q = new URLSearchParams(window.location.search).get("tab") as SettingsTab | null;
    return q && (ALL_TABS as string[]).includes(q) ? q : null;
  })();

  const [tab, setTab]     = useState<SettingsTab>(urlTab ?? defaultTab);

  // If the user navigates to /settings?tab=economics after the component
  // has already mounted (rare, but possible via forward/back), sync.
  useEffect(() => {
    if (urlTab) setTab(urlTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  // Filter nav groups by role + drop empty groups
  const visibleGroups = NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        if (it.adminOnly  && !isAdmin)          return false;
        if (it.managerPlus && !isManagerOrAbove) return false;
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  const allVisibleItems = visibleGroups.flatMap((g) => g.items);
  const effectiveTab    = allVisibleItems.some((n) => n.id === tab) ? tab : "account";

  function handleClose() {
    if (window.history.length > 1) window.history.back();
    else navigate("/");
  }

  // Close on ESC + lock background scroll while modal is mounted
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={handleClose}
    >
      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "92vh", height: "92vh" }}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-gray-700 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>settings</span>
            <h1 id="settings-modal-title" className="text-lg font-semibold text-gray-900">Settings</h1>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close settings"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0">

          {/* Left: grouped nav with workspace selector */}
          <aside className="w-60 shrink-0 border-r border-gray-200 py-4 overflow-y-auto bg-gray-50/50">
            <WorkspaceSelector />

            <nav className="space-y-5 px-2">
              {visibleGroups.map((group) => (
                <div key={group.id}>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-2 mb-1.5">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = effectiveTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setTab(item.id)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] transition-colors text-left",
                            active
                              ? "bg-white text-[#1a73e8] font-semibold shadow-sm border border-gray-200"
                              : "text-gray-700 hover:bg-white/70 font-normal",
                          )}
                        >
                          <span
                            className="material-symbols-outlined text-[17px] shrink-0"
                            style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                          >
                            {item.icon}
                          </span>
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {/* Right: tab content */}
          <main className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
            {effectiveTab === "account"         && <AccountTab />}
            {effectiveTab === "personalization" && <PersonalizationTab />}
            {effectiveTab === "security"        && <SecurityTab />}
            {effectiveTab === "workspace"       && <WorkspaceTab />}
            {effectiveTab === "notifications"   && <NotificationsTab />}
            {effectiveTab === "budget"          && <BudgetTab />}
            {effectiveTab === "economics"       && <EconomicsTab />}
            {effectiveTab === "fx-overrides"    && <FxOverridesTab />}
            {effectiveTab === "ai-quota"        && <AiQuotaTab />}
            {effectiveTab === "integrations"    && <IntegrationsTab />}
            {effectiveTab === "billing"         && <BillingTab />}
            {effectiveTab === "members"         && <MembersTab />}
          </main>

        </div>
      </div>
    </div>
  );
}
