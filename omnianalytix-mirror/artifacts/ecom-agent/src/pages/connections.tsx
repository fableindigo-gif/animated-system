import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useListConnections, CreateConnectionBodyPlatform, getListConnectionsQueryKey } from "@workspace/api-client-react";
import { GoogleWorkspaceSetupDialog } from "@/components/connections/google-workspace-setup-dialog";
import { MetaSetupDialog, MetaOAuthDialog } from "@/components/connections/meta-oauth-dialog";
import { ShopifyOAuthDialog } from "@/components/connections/shopify-oauth-dialog";
import { ConnectionFailedModal } from "@/components/connections/connection-failed-modal";
import { PrerequisiteHint } from "@/components/connections/prerequisite-hint";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { EtlSyncBanner, type EtlStatus } from "@/components/etl-sync-banner";
import { MetricTooltip } from "@/components/help/metric-tooltip";
import { TokenExpiredState } from "@/components/enterprise/token-expired-state";
import { useWorkspace } from "@/contexts/workspace-context";
import { authFetch } from "@/lib/auth-fetch";
import { formatUsdInDisplay } from "@/lib/fx-format";
import { CredentialRequestModal } from "@/components/enterprise/credential-request-modal";
import { CredentialHelp, getHelpRecipe } from "@/components/connections/credential-help";
import { CrmPipelineMappingModal } from "@/components/connections/crm-pipeline-modal";
import { LookerEmbedCard } from "@/components/connections/looker-embed-card";
import { DbConnectModal } from "@/components/connections/db-connect-modal";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

type WorkspaceGoal = "ecom" | "leadgen" | "hybrid";

const SECTION_VISIBILITY: Record<string, WorkspaceGoal[]> = {
  google_workspace: ["ecom", "leadgen", "hybrid"],
  meta_ads:         ["ecom", "leadgen", "hybrid"],
  bing_ads:         ["leadgen", "hybrid"],
  shopify:          ["ecom", "hybrid"],
  woocommerce:      ["ecom", "hybrid"],
  crm:              ["ecom", "leadgen", "hybrid"],
  ad_channels:      ["ecom", "leadgen", "hybrid"],
  ops_finance:      ["ecom", "leadgen", "hybrid"],
};

function isSectionVisible(section: string, goal: WorkspaceGoal): boolean {
  const allowed = SECTION_VISIBILITY[section];
  return allowed ? allowed.includes(goal) : true;
}

// Minimum-viable connection set per goal. Each "slot" is satisfied when
// any of the listed platforms reports a healthy/active connection. Used
// to drive the top-of-page progress strip and the "next missing card"
// scroll target for new users.
type ConnectionSlot = {
  id: string;
  label: string;
  /** Platforms that satisfy this slot (any-of). */
  anyOf: string[];
  /** data-focus-platform value to scroll to when this slot is missing. */
  focus: string;
};
const MIN_VIABLE_SET: Record<WorkspaceGoal, ConnectionSlot[]> = {
  ecom: [
    { id: "store", label: "store",        anyOf: ["shopify", "woocommerce"],          focus: "shopify" },
    { id: "ads",   label: "ad platform",  anyOf: ["google_ads", "meta", "bing_ads"],  focus: "google_workspace" },
  ],
  leadgen: [
    { id: "ads",   label: "ad platform",  anyOf: ["google_ads", "meta", "bing_ads"],         focus: "google_workspace" },
    { id: "crm",   label: "CRM",          anyOf: ["hubspot", "salesforce", "zoho"],          focus: "crm" },
  ],
  hybrid: [
    { id: "store", label: "store",        anyOf: ["shopify", "woocommerce"],          focus: "shopify" },
    { id: "ads",   label: "ad platform",  anyOf: ["google_ads", "meta", "bing_ads"],  focus: "google_workspace" },
  ],
};

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MetaLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 18" fill="none">
      <path d="M5.87 1.8C4.13 1.8 2.7 3.5 1.74 5.85c-1.22 3-1.74 6.6-1.74 8.1 0 2.27.92 3.43 2.62 3.43 1.83 0 3.32-1.58 5.12-4.92L9.6 9.5l.37-.7C11.5 5.62 13.1 3.48 15 2.32c-1.17-.35-2.4-.52-3.45-.52-2.42 0-4.05 1.14-5.68 3.83a11.24 11.24 0 0 0-.96 2.03c-.39-1.45-.83-2.63-1.4-3.56C2.64 2.72 3.93 1.8 5.87 1.8z" fill="#0081FB"/>
      <path d="M15 2.32c-1.9 1.16-3.5 3.3-5.03 6.47l-.37.71-1.86 3.96c-1.8 3.34-3.3 4.92-5.12 4.92.08.01.15.02.23.02 3.77 0 6.16-4.08 7.41-6.58l1.76-3.53c1.04-2.05 2.3-3.92 3.88-4.85.36-.21.73-.4 1.1-.55-.61-.35-1.27-.47-2-.57z" fill="#0081FB"/>
      <path d="M23 1.8c-2.56 0-4.83 2.36-6.82 5.76L14.38 11l-.62 1.2c-1.25 2.5-3.64 6.58-7.41 6.58-.08 0-.15 0-.23-.02C7.56 19.45 9.3 20 11.48 20c2.4 0 4.34-1.3 6.02-3.85L19 13.82l1.44-2.67c.87-1.6 1.75-2.87 2.67-3.68C23.98 6.66 24.93 6 26.2 6c1.2 0 1.9.68 1.9 1.86 0 .8-.3 1.87-.87 3.2L25.5 14.6c-.45 1.06-.68 1.95-.68 2.73 0 1.64 1 2.67 2.75 2.67 2.7 0 4.52-2.08 6.02-6.05l-.94-.42c-1.14 2.8-2.27 4.24-3.4 4.24-.58 0-.87-.37-.87-.97 0-.5.18-1.22.6-2.2l1.74-3.6c.7-1.47 1.07-2.73 1.07-3.77C31.8 3.86 30 1.8 27 1.8c-2.4 0-4.08 1.58-5.68 3.86a13.23 13.23 0 0 0-.96 1.7c-.39-1.24-.83-2.27-1.36-3.06-.71-1.06-1.98-2-3-2.35-.66-.14-1.34-.15-2-.15h-1z" fill="#0081FB"/>
    </svg>
  );
}

function ShopifyLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 109.5 124.5" fill="none">
      <path d="M95.6 28.2c-.1-.6-.6-1-1.1-1-.5 0-10.3-1.1-10.3-1.1s-6.8-6.8-7.5-7.5c-.7-.7-2.1-.5-2.6-.3 0 0-1.4.4-3.6 1.1-2.2-6.3-6-12.1-12.7-12.1h-.6C55.6 5.2 53.6 4 51.9 4c-15.7 0-23.2 19.6-25.5 29.5-6.1 1.9-10.4 3.2-10.9 3.4-3.4 1.1-3.5 1.2-3.9 4.4-.3 2.4-9.2 71-9.2 71l73.1 12.7V28.3c-.3 0-.7-.1-.9-.1zM73.3 22.3c-2.5.8-5.3 1.6-8.2 2.5v-1.8c0-5.4-.8-9.8-2-13.2 4.9.9 8.2 6.3 10.2 12.5zM58.5 11.1c1.4 3.3 2.3 8 2.3 14.4v.9l-16 4.9c3.1-11.8 8.9-17.3 13.7-20.2zM51.6 7.2c.9 0 1.8.3 2.6 1-6.5 3.1-13.4 10.8-16.3 26.2-4.4 1.4-8.7 2.7-12.8 4C28.4 28.2 36.6 7.2 51.6 7.2z" fill="#95BF47"/>
      <path d="M94.5 27.2c-.5 0-10.3-1.1-10.3-1.1s-6.8-6.8-7.5-7.5c-.3-.3-.6-.4-.9-.4v106.3l36.5-7.9S95.3 27.8 95.2 27.5c-.1-.2-.3-.3-.7-.3z" fill="#5E8E3E"/>
      <path d="M57.7 43.8L53.6 58s-4.4-2-9.7-2c-7.8 0-8.2 4.9-8.2 6.1 0 6.7 17.5 9.3 17.5 25 0 12.4-7.8 20.3-18.4 20.3-12.7 0-19.2-7.9-19.2-7.9l3.4-11.2s6.7 5.7 12.3 5.7c3.7 0 5.2-2.9 5.2-5 0-8.8-14.3-9.2-14.3-23.6C22.2 53.2 32.4 40 48.3 40c6.2 0 9.4 1.8 9.4 1.8v2z" fill="white"/>
    </svg>
  );
}

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="0"   y="0"   width="10" height="10" fill="#F25022"/>
      <rect x="11"  y="0"   width="10" height="10" fill="#7FBA00"/>
      <rect x="0"   y="11"  width="10" height="10" fill="#00A4EF"/>
      <rect x="11"  y="11"  width="10" height="10" fill="#FFB900"/>
    </svg>
  );
}

function WooCommerceLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 2500 1500" fill="none">
      <path d="M228 0h2044c126 0 228 102 228 228v770c0 126-102 228-228 228H1460l124 274-448-274H228C102 1226 0 1124 0 998V228C0 102 102 0 228 0z" fill="#7F54B3"/>
      <path d="M309 260c27-36 65-55 112-58 85-5 132 40 140 135 40 479 83 884 128 1214L1032 606c39-78 89-120 149-124 87-6 138 57 154 188 21 172 50 318 88 438 24-325 65-562 122-711 27-70 63-107 110-111 39-3 73 11 102 42 29 31 42 69 39 113-2 33-14 68-35 107l-174 325c-30 55-64 94-103 116-42 24-83 27-123 10-37-16-67-49-90-101-38-86-68-186-90-301-73 144-127 254-162 332-64 140-119 215-165 225-30 7-60-15-90-66-78-130-162-481-251-1052-7-43 4-81 31-117zm1828 0c27-36 65-55 112-58 85-5 132 40 140 135 40 479 83 884 128 1214l343-945c39-78 89-120 149-124 87-6 138 57 154 188 21 172 50 318 88 438 24-325 65-562 122-711 27-70 63-107 110-111 39-3 73 11 102 42 29 31 42 69 39 113-2 33-14 68-35 107l-174 325c-30 55-64 94-103 116-42 24-83 27-123 10-37-16-67-49-90-101-38-86-68-186-90-301-73 144-127 254-162 332-64 140-119 215-165 225-30 7-60-15-90-66-78-130-162-481-251-1052-7-43 4-81 31-117z" fill="white"/>
    </svg>
  );
}

function HubSpotLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="none">
      <path d="M371.7 238.3V167c15.3-8.5 25.6-24.8 25.6-43.5v-1.3c0-27.5-22.3-49.8-49.8-49.8h-1.3c-27.5 0-49.8 22.3-49.8 49.8v1.3c0 18.7 10.3 35 25.6 43.5v71.3c-23.3 5.8-44.5 17-62 32.8L136.2 174c1.8-5.8 2.8-12 2.8-18.3 0-35.3-28.7-64-64-64S11 120.3 11 155.7s28.7 64 64 64c10.5 0 20.3-2.5 29-7l121 95c-18.5 24.8-29.5 55.5-29.5 88.8 0 82 66.5 148.5 148.5 148.5s148.5-66.5 148.5-148.5c0-69-47.3-127-111.3-143.2zm-27.7 215c-40 0-72.5-32.5-72.5-72.5s32.5-72.5 72.5-72.5 72.5 32.5 72.5 72.5-32.5 72.5-72.5 72.5z" fill="#FF7A59"/>
    </svg>
  );
}

function SalesforceLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 180" fill="none">
      <path d="M106.7 16.1c12.1-12.6 29-20.4 47.7-20.4 24.6 0 46 13.4 57.5 33.3 10-4.4 21-6.9 32.6-6.9 44.2 0 80 35.8 80 80s-35.8 80-80 80c-5.8 0-11.4-.6-16.8-1.8-9.9 18.6-29.6 31.3-52.2 31.3-10.2 0-19.8-2.6-28.2-7.2-10.5 19.4-31 32.6-54.7 32.6-23.2 0-43.3-12.7-54-31.5-4.3.9-8.8 1.3-13.3 1.3C11.6 206.8-12 183.2-12 154c0-18 9.1-33.9 22.9-43.4-3.5-8.1-5.4-17-5.4-26.3C5.5 47.1 36.6 16 73.8 16c13.2 0 25.5 3.8 35.9 10.3l-3-.2z" transform="translate(12 -12)" fill="#00A1E0"/>
    </svg>
  );
}

function MailchimpLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M18.93 11.6c-.32-.78-.85-1.45-1.53-1.91.15-.85-.02-1.6-.51-2.14-.59-.65-1.55-.92-2.47-.73-.64-.7-1.52-1.14-2.48-1.22-.99-.09-1.98.17-2.76.73-.65-.36-1.38-.55-2.13-.55-1.2 0-2.32.56-3.08 1.51-.66.82-1.02 1.87-1.02 2.95 0 .5.08.99.22 1.45-.57.62-.9 1.42-.93 2.27-.04 1.02.36 2 1.1 2.72a3.58 3.58 0 0 0 2.63 1.07c.15 0 .31-.01.46-.03.5.56 1.15.97 1.87 1.18.46.13.94.2 1.42.2.86 0 1.7-.23 2.44-.67.66.31 1.39.47 2.13.47 1.15 0 2.24-.43 3.06-1.21.86-.82 1.35-1.94 1.37-3.15.01-.92-.25-1.82-.77-2.56.05-.12.09-.25.13-.38z" fill="#FFE01B"/>
      <path d="M17.36 14.17c-.28.92-.9 1.68-1.73 2.13-.6.32-1.27.45-1.92.36a4.88 4.88 0 0 1-1.73 1.18c-.64.28-1.33.38-2.02.28a3.36 3.36 0 0 1-1.73-1c-.95.19-1.92-.05-2.66-.67-.67-.56-1.08-1.35-1.14-2.2a3.42 3.42 0 0 1-.13-2.85c-.42-.79-.52-1.7-.27-2.56.28-.96.95-1.74 1.86-2.18.23-.95.82-1.78 1.66-2.3.92-.57 2.03-.73 3.07-.44.74-.68 1.72-1.06 2.74-1.06h.12c.85.04 1.65.35 2.3.89.83-.08 1.64.18 2.22.73.49.47.76 1.1.77 1.79a4.3 4.3 0 0 1 1.44 2.13c.29.87.22 1.8-.18 2.62.48.72.72 1.57.62 2.42-.1.93-.57 1.78-1.28 2.38-.58.48-1.28.76-2.01.81" fill="#241C15"/>
    </svg>
  );
}

const GOAL_LABELS: Record<WorkspaceGoal, string> = {
  ecom: "E-Commerce",
  leadgen: "Lead Generation",
  hybrid: "Hybrid",
};

function GoalBadge({ goal }: { goal: WorkspaceGoal }) {
  const icons: Record<WorkspaceGoal, string> = {
    ecom: "shopping_cart",
    leadgen: "contact_page",
    hybrid: "hub",
  };
  const colors: Record<WorkspaceGoal, string> = {
    ecom: "bg-emerald-50 text-emerald-600 border-emerald-200",
    leadgen: "bg-violet-50 text-violet-600 border-violet-200",
    hybrid: "bg-amber-50 text-amber-600 border-amber-200",
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-2xl border text-[10px] font-semibold uppercase tracking-wider", colors[goal])}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icons[goal]}</span>
      {GOAL_LABELS[goal]} mode
    </span>
  );
}

function timeAgo(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * HealthBadge — tri-tone alert system
 *   Emerald  : connected, last sync < 4 h  → "Healthy"
 *   Amber    : connected, last sync 4–12 h  → "Aging"
 *   Crimson  : disconnected OR sync > 12 h  → "Disconnected" / "Sync Stale"
 */
function HealthBadge({
  connected,
  updatedAt,
  errorState = false,
}: {
  connected: boolean;
  updatedAt?: string | null;
  /** True when a connection record exists but is inactive/broken (e.g. expired
   *  token). When false and `connected` is also false, we render the neutral
   *  pre-connection pill instead of the red error pill. */
  errorState?: boolean;
}) {
  const syncAgeHours = updatedAt
    ? (Date.now() - new Date(updatedAt).getTime()) / 3_600_000
    : Infinity;
  const lastSynced = timeAgo(updatedAt);

  if (!connected) {
    if (errorState) {
      // Real broken/expired connection — keep the red pill so per-card
      // health stays consistent with the global TokenExpiredState banner.
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase"
          style={{ background: "var(--color-status-critical-bg)", color: "var(--color-status-critical-fg)", borderColor: "var(--color-status-critical-border)" }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-status-critical-dot)" }} />
          Disconnected
        </span>
      );
    }
    // Pre-connection state — neutral, not failure. The user has not tried
    // to connect this platform yet.
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase bg-surface text-on-surface-variant border-outline-variant/30">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-on-surface-variant/40" />
        Not connected yet
      </span>
    );
  }

  if (syncAgeHours > 12) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase"
          style={{ background: "var(--color-status-critical-bg)", color: "var(--color-status-critical-fg)", borderColor: "var(--color-status-critical-border)" }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-status-critical-dot)" }} />
          Sync Stale
        </span>
        {lastSynced && <span className="text-[10px] text-on-surface-variant">{lastSynced}</span>}
      </div>
    );
  }

  if (syncAgeHours > 4) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase"
          style={{ background: "var(--color-status-warning-bg)", color: "var(--color-status-warning-fg)", borderColor: "var(--color-status-warning-border)" }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-status-warning-dot)" }} />
          Aging
        </span>
        <MetricTooltip content="Data is older than 4 hours. Profit calculations may vary by ±5% until the next sync completes." />
        {lastSynced && <span className="text-[10px] text-on-surface-variant">{lastSynced}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase"
        style={{ background: "var(--color-status-success-bg)", color: "var(--color-status-success-fg)", borderColor: "var(--color-status-success-border)" }}>
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--color-status-success-dot)" }} />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "var(--color-status-success-dot)" }} />
        </span>
        Healthy
      </span>
      {lastSynced && <span className="text-[10px] text-on-surface-variant">{lastSynced}</span>}
    </div>
  );
}

function WooCommerceModal({
  open,
  onClose,
  onConnect,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (url: string, key: string, secret: string) => void;
  saving: boolean;
}) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim() || !key.trim() || !secret.trim()) {
      setError("All three fields are required.");
      return;
    }
    setError("");
    onConnect(url.trim(), key.trim(), secret.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-8">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center shrink-0">
              <WooCommerceLogo className="w-6 h-6" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-lg text-on-surface">Connect WooCommerce</DialogTitle>
              <DialogDescription className="text-xs text-on-surface-variant mt-1">
                Enter your WooCommerce REST API credentials. You can find these in WooCommerce → Settings → Advanced → REST API.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <CredentialHelp
          platformLabel="WooCommerce"
          steps={getHelpRecipe("woocommerce")?.steps ?? []}
          docsUrl={getHelpRecipe("woocommerce")?.docsUrl}
          className="mb-1"
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="woo-store-url"
              className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5"
            >
              Store URL
            </label>
            <input
              id="woo-store-url"
              className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 focus:ring-2 focus:ring-[var(--color-brand-woocommerce)]/20 focus:border-[var(--color-brand-woocommerce)]/30 outline-none transition-all placeholder:text-on-surface-variant"
              placeholder="https://yourstore.com"
              type="text"
              autoComplete="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(""); }}
            />
          </div>
          <div>
            <label
              htmlFor="woo-consumer-key"
              className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5"
            >
              Consumer Key
            </label>
            <input
              id="woo-consumer-key"
              className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 focus:ring-2 focus:ring-[var(--color-brand-woocommerce)]/20 focus:border-[var(--color-brand-woocommerce)]/30 outline-none transition-all placeholder:text-on-surface-variant font-mono"
              placeholder="ck_..."
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(""); }}
            />
          </div>
          <div>
            <label
              htmlFor="woo-consumer-secret"
              className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5"
            >
              Consumer Secret
            </label>
            <input
              id="woo-consumer-secret"
              className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 focus:ring-2 focus:ring-[var(--color-brand-woocommerce)]/20 focus:border-[var(--color-brand-woocommerce)]/30 outline-none transition-all placeholder:text-on-surface-variant font-mono"
              placeholder="cs_..."
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setError(""); }}
            />
          </div>
          {error && (
            <div role="alert" className="flex items-center gap-2 text-xs text-error-m3 bg-error-container rounded-2xl px-4 py-2.5">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">error</span>
              {error}
            </div>
          )}

          <DialogFooter className="!mt-6 flex-row gap-3 sm:justify-stretch">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-[var(--color-brand-woocommerce)] hover:bg-[var(--color-brand-woocommerce-hover)] text-white text-sm font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <span className="material-symbols-outlined text-sm animate-spin" aria-hidden="true">progress_activity</span>
                  Connecting…
                </>
              ) : "Connect Store"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-5 py-3 border border-outline-variant/15 text-sm text-on-surface-variant font-medium rounded-2xl hover:bg-surface transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyModal({
  config,
  onClose,
  onConnect,
  saving,
}: {
  config: {
    platform: string;
    title: string;
    color: string;
    fields: Array<{ key: string; label: string; placeholder: string; type?: string; hint?: string }>;
  } | null;
  onClose: () => void;
  onConnect: (platform: string, creds: Record<string, string>) => void;
  saving: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (config) setValues({});
    setError("");
  }, [config]);

  if (!config) return null;

  const handleSubmit = () => {
    const missing = config.fields.filter((f) => !values[f.key]?.trim());
    if (missing.length) { setError(`${missing[0].label} is required.`); return; }
    setError("");
    onConnect(config.platform, values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-8 animate-in fade-in zoom-in-95 duration-200 max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: `${config.color}18`, border: `1px solid ${config.color}30` }}>
              <span className="material-symbols-outlined text-xl" style={{ color: config.color }}>link</span>
            </div>
            <h3 className="font-bold text-lg text-on-surface">{config.title}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">close</span>
          </button>
        </div>

        <p className="text-xs text-on-surface-variant mb-3">Your credentials are encrypted before storage. OmniAnalytix uses read-only access scopes.</p>

        {(() => {
          const recipe = getHelpRecipe(config.platform);
          if (!recipe) return null;
          return (
            <div className="mb-4">
              <CredentialHelp
                platformLabel={config.title}
                steps={recipe.steps}
                docsUrl={recipe.docsUrl}
              />
            </div>
          );
        })()}

        <div className="space-y-4 mb-6">
          {config.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">{field.label}</label>
              <input
                className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 outline-none focus:ring-2 transition-all placeholder:text-on-surface-variant font-mono"
                style={{ ['--tw-ring-color' as string]: config.color } as React.CSSProperties}
                placeholder={field.placeholder}
                type={field.type ?? "password"}
                value={values[field.key] ?? ""}
                onChange={(e) => { setValues((v) => ({ ...v, [field.key]: e.target.value })); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              />
              {field.hint && <p className="text-[10px] text-on-surface-variant mt-1">{field.hint}</p>}
            </div>
          ))}
          {error && (
            <div className="flex items-center gap-2 text-xs text-error-m3 bg-error-container rounded-2xl px-4 py-2.5">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-3 text-white text-sm font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: config.color }}
          >
            {saving ? <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>Connecting…</> : "Connect"}
          </button>
          <button onClick={onClose} className="px-5 py-3 border border-outline-variant/15 text-sm text-on-surface-variant font-medium rounded-2xl hover:bg-surface transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Connections() {
  const { data: connections, isLoading } = useListConnections();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();
  const goal: WorkspaceGoal = useMemo(() => {
    const raw = activeWorkspace?.primaryGoal;
    if (raw === "leadgen" || raw === "hybrid") return raw;
    return "ecom";
  }, [activeWorkspace?.primaryGoal]);

  const [shopifyJustConnected, setShopifyJustConnected] = useState(false);
  const [shopName, setShopName] = useState("your Shopify store");
  const [etlStatus, setEtlStatus] = useState<EtlStatus | null>(null);
  const etlPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [workspaceSetupKey, setWorkspaceSetupKey] = useState<string | null>(null);
  const [workspaceSetupEmail, setWorkspaceSetupEmail] = useState("");
  const [isWorkspaceSetupOpen, setIsWorkspaceSetupOpen] = useState(false);

  const [metaSetupKey, setMetaSetupKey] = useState<string | null>(null);
  const [metaSetupEmail, setMetaSetupEmail] = useState("");
  const [isMetaSetupOpen, setIsMetaSetupOpen] = useState(false);

  const [isMetaOAuthOpen, setIsMetaOAuthOpen] = useState(false);
  const [isShopifyOAuthOpen, setIsShopifyOAuthOpen] = useState(false);
  const [isGoogleConnecting, setIsGoogleConnecting] = useState(false);
  const [googleHealth, setGoogleHealth] = useState<Record<string, { status: "healthy" | "needs_reconnect" | "not_connected"; errorCode?: string }>>({});
  const [googleAdsSyncing, setGoogleAdsSyncing] = useState(false);
  const [googleAdsSyncMsg, setGoogleAdsSyncMsg] = useState<string | null>(null);

  const [connError, setConnError] = useState<{ code: string; platform: string } | null>(null);
  const [newClientBanner, setNewClientBanner] = useState<string | null>(() => {
    const name = sessionStorage.getItem("omni_new_workspace");
    if (name) sessionStorage.removeItem("omni_new_workspace");
    return name;
  });

  const isAdmin = (() => {
    const r = (localStorage.getItem("omni_user_role") ?? "member").toLowerCase();
    return r === "admin" || r === "agency_owner";
  })();

  const [isWooModalOpen, setIsWooModalOpen] = useState(false);
  const [wooSaving, setWooSaving] = useState(false);
  const [apiKeyModal, setApiKeyModal] = useState<null | {
    platform: string; title: string; color: string;
    fields: Array<{ key: string; label: string; placeholder: string; type?: string; hint?: string }>;
  }>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [calendarCreating, setCalendarCreating] = useState(false);
  const [credRequestPlatform, setCredRequestPlatform] = useState<string | null>(null);
  const [pipelineModalPlatform, setPipelineModalPlatform] = useState<string | null>(null);
  const [byodbType, setByodbType] = useState<"postgres" | "mysql" | "snowflake" | "bigquery" | null>(null);
  const [byodbCredentials, setByodbCredentials] = useState<Array<{ id: number; dbType: string; label: string; host: string; status: string; databaseName: string; createdAt: string }>>([]);

  const [isForceSyncing, setIsForceSyncing] = useState(false);
  const [showAllSections, setShowAllSections] = useState(false);

  const [domainUrl, setDomainUrl] = useState(activeWorkspace?.websiteUrl ?? "");
  const [domainSaving, setDomainSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: "", description: "", onConfirm: () => {} });
  const isDomainSaved = !!(activeWorkspace?.websiteUrl);

  useEffect(() => {
    setDomainUrl(activeWorkspace?.websiteUrl ?? "");
  }, [activeWorkspace?.websiteUrl]);

  // Welcome-overlay deep-link: scroll to and highlight the integration card
  // for the goal-relevant platform (?focus=… or sessionStorage fallback).
  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("focus");
    const fromStorage = sessionStorage.getItem("omni_first_step_focus");
    const target = fromUrl || fromStorage;
    if (!target) return;

    const tryFocus = () => {
      const el = document.querySelector<HTMLElement>(`[data-focus-platform="${target}"]`);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.setAttribute("data-focused", "true");
      window.setTimeout(() => el.removeAttribute("data-focused"), 3500);
      return true;
    };

    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      if (tryFocus() || attempts >= 20) {
        window.clearInterval(id);
        sessionStorage.removeItem("omni_first_step_focus");
        if (fromUrl) {
          params.delete("focus");
          const qs = params.toString();
          setLocation(`/connections${qs ? `?${qs}` : ""}`, { replace: true });
        }
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [isLoading, setLocation]);

  const loadByodbCredentials = useCallback(() => {
    authFetch(`${API_BASE}api/byodb/credentials`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setByodbCredentials(data))
      .catch((err) => {
        console.error("[Connections] Failed to load BYODB credentials:", err);
        toast({
          title: "Couldn't load your saved warehouse credentials",
          description: "Check your connection and try again.",
          variant: "destructive",
          action: { label: "Retry", onClick: () => loadByodbCredentials() },
        });
      });
  }, [toast]);

  useEffect(() => {
    loadByodbCredentials();
  }, [loadByodbCredentials]);

  const stopPolling = () => {
    if (etlPollRef.current) { clearInterval(etlPollRef.current); etlPollRef.current = null; }
  };

  const pollEtlStatus = async () => {
    try {
      const resp = await authFetch(`${API_BASE}api/etl/status`);
      if (!resp.ok) return;
      const data = await resp.json() as EtlStatus;
      setEtlStatus(data);
      if (data.etlStatus === "complete" || data.etlStatus === "error") {
        stopPolling();
        setIsForceSyncing(false);
      }
    } catch { /* retry */ }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("shopify") === "connected") {
      const shop = params.get("shop") ?? "your Shopify store";
      setShopName(shop);
      setShopifyJustConnected(true);
      toast({
        title: "Shopify connected",
        description: `Pulling 90 days of orders from ${shop} — your dashboard will be live in ~5 minutes.`,
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      setLocation("/connections", { replace: true });
      void pollEtlStatus();
      etlPollRef.current = setInterval(() => void pollEtlStatus(), 2_000);
      return;
    }

    const googleSetup = params.get("google_setup");
    if (googleSetup) {
      setWorkspaceSetupEmail(params.get("email") ?? "");
      setWorkspaceSetupKey(googleSetup);
      setIsWorkspaceSetupOpen(true);
      setLocation("/connections", { replace: true });
      return;
    }

    const metaSetup = params.get("meta_setup");
    if (metaSetup) {
      setMetaSetupKey(metaSetup);
      setMetaSetupEmail(params.get("email") ?? "");
      setIsMetaSetupOpen(true);
      setLocation("/connections", { replace: true });
      return;
    }

    if (params.get("bing_ads") === "connected") {
      toast({
        title: "Bing Ads connected",
        description: "Pulling the last 30 days of campaigns — first metrics will appear within ~3 minutes.",
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      setLocation("/connections", { replace: true });
      return;
    }

    if (params.get("zoho") === "connected") {
      toast({
        title: "Zoho CRM connected",
        description: "Pulling contacts, deals and pipelines — your CRM dashboards will populate in ~3 minutes.",
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      setLocation("/connections", { replace: true });
      return;
    }

    if (params.get("salesforce") === "connected") {
      toast({
        title: "Salesforce connected",
        description: "Pulling accounts, opportunities and pipelines — your CRM dashboards will populate in ~3 minutes.",
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      setLocation("/connections", { replace: true });
      return;
    }

    if (params.get("hubspot") === "connected") {
      toast({
        title: "HubSpot connected",
        description: "Pulling contacts, deals and pipelines — your CRM dashboards will populate in ~3 minutes.",
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      setLocation("/connections", { replace: true });
      return;
    }

    const connErrorCode = params.get("conn_error");
    const connPlatform = params.get("conn_platform");
    if (connErrorCode && connPlatform) {
      setConnError({ code: connErrorCode, platform: connPlatform });
      setLocation("/connections", { replace: true });
      return;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopPolling(), []);

  // Probe each Google Workspace connection (Calendar / Drive / Docs) so we
  // can flag a stale refresh_token before the user hits a 502 on the actual
  // Calendar / Drive / Docs API call. Cheap to refresh on each visit and
  // whenever the underlying connections list changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await authFetch(`${API_BASE}api/connections/google/health`);
        if (!resp.ok) return;
        const data = await resp.json() as {
          platforms?: Record<string, { status: "healthy" | "needs_reconnect" | "not_connected"; errorCode?: string }>;
        };
        if (!cancelled && data.platforms) setGoogleHealth(data.platforms);
      } catch { /* probe is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [connections]);

  const handleGoHome = () => setLocation("/");

  const handleGoogleAuthorize = () => {
    setIsGoogleConnecting(true);
    const apiBase = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
    window.location.href = `${apiBase}/api/auth/google/start?platform=workspace`;
  };

  const handleGoogleAdsSync = async () => {
    setGoogleAdsSyncing(true);
    setGoogleAdsSyncMsg(null);
    try {
      const r = await authFetch(`${API_BASE}api/google-ads/sync`, { method: "POST" });
      const json = await r.json() as { success?: boolean; rows?: number; days?: number; spend?: number; error?: string };
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
    setGoogleAdsSyncMsg(`Synced ${json.rows} rows · ${json.days} days · ${formatUsdInDisplay(json.spend ?? 0)} spend`);
      toast({ title: "Google Ads Synced", description: `${json.rows} channel-day rows pulled from the API.` });
    } catch (e) {
      toast({
        title: "Couldn't sync Google Ads",
        description: e instanceof Error ? e.message : "We hit a snag pulling your latest campaign data.",
        variant: "destructive",
        action: { label: "Retry sync", onClick: () => { void handleGoogleAdsSync(); } },
      });
    } finally {
      setGoogleAdsSyncing(false);
    }
  };

  const handleGoogleDisconnect = () => {
    setConfirmDialog({
      open: true,
      title: "Disconnect Google Services",
      description: "This will disconnect all Google services. Continue?",
      onConfirm: async () => {
        const apiBase = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
        try {
          await authFetch(`${apiBase}/api/auth/google/disconnect`, { method: "POST" });
          toast({ title: "Google Disconnected", description: "All Google tokens removed." });
          queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
        } catch {
          toast({ title: "Error", description: "Could not disconnect.", variant: "destructive" });
        }
      },
    });
  };

  const shopifyConn = connections?.find((c) => c.platform === CreateConnectionBodyPlatform.shopify);
  const isShopifyConnected = shopifyConn?.isActive;
  const shopifyDomain = (shopifyConn as any)?.credentials?.shop ?? (shopifyConn as any)?.displayName ?? "your-store.myshopify.com";

  const googleConn = connections?.find((c) => c.platform === CreateConnectionBodyPlatform.google_ads);
  const isGoogleConnected = !!googleConn && (googleConn as any)?.isActive !== false;

  const metaConn = connections?.find((c) => c.platform === CreateConnectionBodyPlatform.meta);
  const isMetaConnected = !!metaConn?.isActive;

  const wooConn = connections?.find((c) => (c.platform as string) === "woocommerce");
  const isWooConnected = !!wooConn?.isActive;

  const salesforceConn = connections?.find((c) => (c.platform as string) === "salesforce");
  const salesforceConnected = !!salesforceConn?.isActive;
  const hubspotConn = connections?.find((c) => (c.platform as string) === "hubspot");
  const hubspotConnected = !!hubspotConn?.isActive;
  const bingConn = connections?.find((c) => (c.platform as string) === "bing_ads");
  const bingConnected = !!bingConn?.isActive;
  const zohoConn = connections?.find((c) => (c.platform as string) === "zoho");
  const zohoConnected = !!zohoConn?.isActive;

  const tiktokConn    = connections?.find((c) => (c.platform as string) === "tiktok_ads");
  const tiktokConnected = !!tiktokConn?.isActive;
  const linkedinConn  = connections?.find((c) => (c.platform as string) === "linkedin_ads");
  const linkedinConnected = !!linkedinConn?.isActive;
  const amazonConn    = connections?.find((c) => (c.platform as string) === "amazon_ads");
  const amazonConnected = !!amazonConn?.isActive;
  const slackConn     = connections?.find((c) => (c.platform as string) === "slack");
  const slackConnected = !!slackConn?.isActive;
  const stripeConn    = connections?.find((c) => (c.platform as string) === "stripe");
  const stripeConnected = !!stripeConn?.isActive;
  const klaviyoConn   = connections?.find((c) => (c.platform as string) === "klaviyo");
  const klaviyoConnected = !!klaviyoConn?.isActive;
  const gCalConn      = connections?.find((c) => (c.platform as string) === "google_calendar");
  const gCalConnected  = !!gCalConn?.isActive;
  const gDriveConn    = connections?.find((c) => (c.platform as string) === "google_drive");
  const gDriveConnected = !!gDriveConn?.isActive;
  const gDocsConn     = connections?.find((c) => (c.platform as string) === "google_docs");
  const gDocsConnected  = !!gDocsConn?.isActive;

  const handleShopifyDisconnect = () => {
    if (!shopifyConn) return;
    setConfirmDialog({
      open: true,
      title: "Disconnect Shopify",
      description: "This will remove the Shopify connection and stop syncing store data. Continue?",
      onConfirm: async () => {
        try {
          await authFetch(`${API_BASE}api/connections/${shopifyConn.id}`, { method: "DELETE" });
          queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
          toast({ title: "Shopify Disconnected" });
        } catch {
          toast({ title: "Error", variant: "destructive" });
        }
      },
    });
  };

  const handleWooConnect = async (url: string, ck: string, cs: string) => {
    setWooSaving(true);
    try {
      const storeLabel = url.replace(/^https?:\/\//, "").split("/")[0];
      const resp = await authFetch(`${API_BASE}api/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "woocommerce", displayName: storeLabel, credentials: { storeUrl: url, consumerKey: ck, consumerSecret: cs } }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to save");
      }
      await queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      toast({ title: "WooCommerce Connected", description: `${storeLabel} synced via REST API.` });
      setIsWooModalOpen(false);
    } catch (e: unknown) {
      toast({ title: "Connection Error", description: e instanceof Error ? e.message : "Could not connect.", variant: "destructive" });
    } finally { setWooSaving(false); }
  };

  const handleForceSync = async () => {
    setIsForceSyncing(true);
    try {
      const resp = await authFetch(`${API_BASE}api/etl/trigger`, { method: "POST" });
      if (!resp.ok) throw new Error("Sync request failed");
      toast({ title: "Master Sync Triggered", description: "All connected data sources are now syncing." });
      stopPolling();
      void pollEtlStatus();
      etlPollRef.current = setInterval(() => void pollEtlStatus(), 2_000);
    } catch {
      toast({
        title: "Couldn't start the sync",
        description: "Check your connection and try again.",
        variant: "destructive",
        action: { label: "Retry", onClick: () => { void handleForceSync(); } },
      });
      setIsForceSyncing(false);
    }
  };

  const handleSaveDomain = async () => {
    const trimmed = domainUrl.trim();
    if (!trimmed || !activeWorkspace) return;
    try {
      new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    } catch {
      toast({ title: "Invalid URL", description: "Please enter a valid website URL.", variant: "destructive" });
      return;
    }
    const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    setDomainSaving(true);
    try {
      const resp = await authFetch(`${API_BASE}api/workspaces/${activeWorkspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: normalized }),
      });
      if (!resp.ok) throw new Error("Failed to save");
      toast({ title: "Domain Saved", description: `Primary website set to ${normalized}` });
      setDomainUrl(normalized);
      refreshWorkspaces();
    } catch {
      toast({ title: "Error", description: "Could not save domain. Please try again.", variant: "destructive" });
    } finally {
      setDomainSaving(false);
    }
  };

  const handleApiKeyConnect = async (
    platform: string,
    credentials: Record<string, string>,
    displayName?: string,
  ) => {
    setApiKeySaving(true);
    try {
      const resp = await authFetch(`${API_BASE}api/integrations/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, credentials, displayName }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to connect");
      }
      await queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      toast({ title: `${displayName ?? platform} Connected`, description: "Integration saved securely." });
      setApiKeyModal(null);
    } catch (e: unknown) {
      toast({ title: "Connection Error", description: e instanceof Error ? e.message : "Could not connect.", variant: "destructive" });
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleSimpleDisconnect = (platform: string, label: string) => {
    setConfirmDialog({
      open: true,
      title: `Disconnect ${label}`,
      description: `This will remove the ${label} integration. Continue?`,
      onConfirm: async () => {
        try {
          await authFetch(`${API_BASE}api/integrations/${platform}`, { method: "DELETE" });
          await queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
          toast({ title: `${label} Disconnected` });
        } catch {
          toast({ title: "Error", variant: "destructive" });
        }
      },
    });
  };

  const handleSlackTest = async () => {
    setSlackTestResult("sending");
    try {
      const resp = await authFetch(`${API_BASE}api/integrations/slack/test`, { method: "POST" });
      const body = await resp.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!resp.ok || !body.success) throw new Error(body.error ?? "Failed");
      setSlackTestResult("ok");
      toast({ title: "Slack Test Sent", description: "Check your Slack channel for the test message." });
    } catch (e: unknown) {
      setSlackTestResult("error");
      toast({ title: "Slack Test Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
    setTimeout(() => setSlackTestResult("idle"), 4000);
  };

  const handleScheduleSweep = async () => {
    setCalendarCreating(true);
    try {
      const resp = await authFetch(`${API_BASE}api/integrations/calendar/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: "OmniAnalytix: 15-min Triage Review", durationMins: 15 }),
      });
      const body = await resp.json().catch(() => ({})) as { htmlLink?: string; error?: string };
      if (!resp.ok) throw new Error(body.error ?? "Failed");
      toast({
        title: "Triage Scheduled",
        description: body.htmlLink ? "Calendar event created — open to view." : "Event created in Google Calendar.",
      });
      if (body.htmlLink) window.open(body.htmlLink, "_blank");
    } catch (e: unknown) {
      toast({ title: "Calendar Error", description: e instanceof Error ? e.message : "Could not create event.", variant: "destructive" });
    } finally {
      setCalendarCreating(false);
    }
  };

  const googleSubServices = useMemo(() => {
    const services = [
      { icon: "ads_click",       color: "text-primary-container", label: "Google Ads",        goals: ["ecom", "leadgen", "hybrid"] as WorkspaceGoal[] },
      { icon: "storefront",      color: "text-orange-500",        label: "Merchant Center",   goals: ["ecom", "hybrid"] as WorkspaceGoal[] },
      { icon: "search",          color: "text-[#60a5fa]",         label: "Search Console",    goals: ["leadgen", "hybrid"] as WorkspaceGoal[] },
      { icon: "video_library",   color: "text-error-m3",          label: "YouTube",           goals: ["ecom", "hybrid"] as WorkspaceGoal[] },
      { icon: "table_chart",     color: "text-[#0F9D58]",         label: "Google Sheets",     goals: ["ecom", "leadgen", "hybrid"] as WorkspaceGoal[] },
      { icon: "bar_chart",       color: "text-amber-600",         label: "Analytics 4",       goals: ["ecom", "leadgen", "hybrid"] as WorkspaceGoal[] },
      { icon: "calendar_month",  color: "text-[#4285F4]",         label: "Calendar",          goals: ["ecom", "leadgen", "hybrid"] as WorkspaceGoal[], badge: gCalConnected,  platform: "google_calendar" },
      { icon: "folder_open",     color: "text-[#FBBC05]",         label: "Drive",             goals: ["ecom", "leadgen", "hybrid"] as WorkspaceGoal[], badge: gDriveConnected, platform: "google_drive" },
      { icon: "description",     color: "text-[#0F9D58]",         label: "Docs",              goals: ["ecom", "leadgen", "hybrid"] as WorkspaceGoal[], badge: gDocsConnected,  platform: "google_docs" },
    ];
    return services.filter((s) => s.goals.includes(goal));
  }, [goal, gCalConnected, gDriveConnected, gDocsConnected]);

  // Drive the top-of-page progress strip from the goal's minimum-viable set.
  const connectionProgress = useMemo(() => {
    const slots = MIN_VIABLE_SET[goal] ?? MIN_VIABLE_SET.ecom;
    const isPlatformActive = (p: string): boolean => {
      switch (p) {
        case "shopify":      return !!isShopifyConnected;
        case "woocommerce":  return isWooConnected;
        case "google_ads":   return isGoogleConnected;
        case "meta":         return isMetaConnected;
        case "bing_ads":     return bingConnected;
        case "hubspot":      return hubspotConnected;
        case "salesforce":   return salesforceConnected;
        case "zoho":         return zohoConnected;
        default:             return false;
      }
    };
    const enriched = slots.map((s) => ({ ...s, satisfied: s.anyOf.some(isPlatformActive) }));
    const done = enriched.filter((s) => s.satisfied).length;
    const total = enriched.length;
    const nextMissing = enriched.find((s) => !s.satisfied) ?? null;
    return { slots: enriched, done, total, nextMissing, complete: done >= total };
  }, [goal, isShopifyConnected, isWooConnected, isGoogleConnected, isMetaConnected, bingConnected, hubspotConnected, salesforceConnected, zohoConnected]);

  const handleScrollToNextMissing = () => {
    if (!connectionProgress.nextMissing) return;
    const target = connectionProgress.nextMissing.focus;
    const el = document.querySelector<HTMLElement>(`[data-focus-platform="${target}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.setAttribute("data-focused", "true");
    window.setTimeout(() => el.removeAttribute("data-focused"), 3500);
  };

  const AUTH_STALE_CODES = ["invalid_grant", "unauthorized_client"];
  const workspaceNeedsReconnect = (["google_calendar", "google_drive", "google_docs"] as const)
    .some((p) => {
      const h = googleHealth[p];
      return h?.status === "needs_reconnect" && (!h.errorCode || AUTH_STALE_CODES.includes(h.errorCode));
    });

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* ── New workspace context banner ───────────────────────────────────── */}
        {newClientBanner && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-primary-container/8 border border-primary-container/20">
            <div className="w-8 h-8 rounded-xl bg-primary-container/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[17px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                rocket_launch
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface">
                Setting up <span className="text-primary-container">{newClientBanner}</span>
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                Connect their data sources below. Each platform you link will appear in their BI dashboards immediately.
              </p>
            </div>
            <button
              onClick={() => setNewClientBanner(null)}
              className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-low transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-black tracking-tight text-on-surface">Platform Connections</h1>
            <div className="flex items-center gap-3">
              <GoalBadge goal={goal} />
              <button
                onClick={handleForceSync}
                disabled={isForceSyncing}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-2xl border text-xs font-semibold transition-all active:scale-95",
                  isForceSyncing
                    ? "border-primary-container/20 bg-primary-container/10 text-primary-container"
                    : "border-outline-variant/15 bg-white text-on-surface-variant hover:border-[#c8c5cb] hover:bg-surface shadow-sm",
                )}
              >
                <span className={cn("material-symbols-outlined text-[16px]", isForceSyncing && "animate-spin")}>
                  {isForceSyncing ? "progress_activity" : "sync"}
                </span>
                {isForceSyncing ? "Syncing…" : "Force Master Sync"}
              </button>
            </div>
          </div>
          <p className="text-on-surface-variant text-sm">Manage your data sources and advertising accounts.</p>
        </div>

        <section className="mb-6 bg-gradient-to-r from-blue-50 via-indigo-50/50 to-blue-50 border-2 border-blue-200/40 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <span className="material-symbols-outlined text-blue-600 text-xl">database</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Connect Your Database</h3>
                <p className="text-xs text-slate-500 mt-0.5">Bring your own data — connect PostgreSQL for instant AI-powered analysis</p>
              </div>
            </div>
            <button
              onClick={() => setByodbType("postgres")}
              className="px-4 py-2 bg-[#2563EB] text-white text-xs font-bold rounded-xl hover:bg-[#1e40af] transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Quick Connect
            </button>
          </div>
        </section>

        {/* ── Goal-driven connection progress strip ─────────────────────── */}
        <section
          data-testid="connection-progress-strip"
          aria-label="Connection progress"
          className={cn(
            "mb-6 rounded-2xl border p-4 sm:p-5 transition-colors",
            connectionProgress.complete
              ? "bg-emerald-50 border-emerald-200"
              : "bg-blue-50 border-blue-200/70",
          )}
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              connectionProgress.complete ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700",
            )}>
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                {connectionProgress.complete ? "check_circle" : "rocket_launch"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface leading-snug">
                {connectionProgress.complete
                  ? "You're set — your dashboard is unlocked."
                  : `Connect ${connectionProgress.slots.map((s) => `1 ${s.label}`).join(" + ")} to unlock your dashboard`}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/70 border border-outline-variant/15 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", connectionProgress.complete ? "bg-emerald-500" : "bg-blue-500")}
                    style={{ width: `${(connectionProgress.done / Math.max(1, connectionProgress.total)) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-on-surface-variant whitespace-nowrap" data-testid="connection-progress-count">
                  {connectionProgress.done} of {connectionProgress.total} connected
                </span>
              </div>
            </div>
            {!connectionProgress.complete && connectionProgress.nextMissing && (
              <button
                type="button"
                onClick={handleScrollToNextMissing}
                data-testid="connection-progress-next"
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white text-xs font-bold transition-all active:scale-95 self-start sm:self-auto"
              >
                Connect {connectionProgress.nextMissing.label}
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_downward</span>
              </button>
            )}
          </div>
        </section>

        {/* Goal filter / show-all toggle */}
        <div className="mb-4 flex items-center justify-between gap-2 text-xs">
          <p className="text-on-surface-variant">
            {showAllSections
              ? "Showing every integration we support."
              : `Showing the ${GOAL_LABELS[goal].toLowerCase()} integrations recommended for your workspace.`}
          </p>
          <button
            type="button"
            onClick={() => setShowAllSections((v) => !v)}
            data-testid="show-all-integrations-toggle"
            className="font-semibold text-primary-container hover:underline whitespace-nowrap"
          >
            {showAllSections ? "Show recommended only" : "Show all integrations"}
          </button>
        </div>

        {shopifyJustConnected && (
          <EtlSyncBanner platform="shopify" accountName={shopName} etl={etlStatus} onDismiss={() => setShopifyJustConnected(false)} onGoHome={handleGoHome} />
        )}

        {(() => {
          const expired = (connections ?? []).filter((c) => c.isActive === false && c.platform !== undefined).map((c) => ({ platform: c.platform, displayName: c.displayName }));
          return expired.length > 0 ? <div className="mb-6"><TokenExpiredState expiredTokens={expired} /></div> : null;
        })()}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("h-44 rounded-2xl skeleton-shimmer", i === 1 && "md:col-span-2")} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm md:col-span-2">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-primary-container/10 border border-primary-container/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-xl text-primary-container">language</span>
                  </div>
                  <div>
                    <h2 className="font-bold text-sm text-on-surface">Primary Website & Domain</h2>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">Landing page audits · SEO · CMS editing</p>
                  </div>
                </div>
                {isDomainSaved && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-on-surface-variant mb-4">
                Enter your client's primary website URL so the AI can audit landing pages, run SEO checks, and propose storefront edits.
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={domainUrl}
                  onChange={(e) => setDomainUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveDomain(); }}
                  placeholder="https://www.client-site.com"
                  className="flex-1 text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/40 outline-none transition-all placeholder:text-on-surface-variant"
                />
                <button
                  onClick={handleSaveDomain}
                  disabled={domainSaving || !domainUrl.trim()}
                  className="px-5 py-3 bg-primary-container hover:bg-primary-m3 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 shrink-0"
                >
                  {domainSaving ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                      Saving…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">save</span>
                      Save Domain
                    </>
                  )}
                </button>
              </div>
              {isDomainSaved && (
                <p className="text-[10px] text-emerald-600 mt-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">check_circle</span>
                  Domain verified and saved — AI can now audit this website.
                </p>
              )}
            </section>

            {(showAllSections || isSectionVisible("google_workspace", goal)) && (
              <section data-focus-platform="google_workspace" className="bg-white border ghost-border rounded-2xl p-6 shadow-sm md:col-span-2 data-[focused=true]:ring-4 data-[focused=true]:ring-[#2563EB]/40 data-[focused=true]:ring-offset-2 transition-all">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white border ghost-border flex items-center justify-center shadow-sm">
                      <GoogleLogo className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-bold text-sm text-on-surface">Google Workspace</h2>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">Ads · Merchant Center · Search Console · Sheets · Analytics · Calendar · Drive · Docs</p>
                    </div>
                  </div>
                  <HealthBadge connected={isGoogleConnected} updatedAt={(googleConn as any)?.updatedAt} errorState={!!googleConn && (googleConn as any)?.isActive === false} />
                </div>
                <div className={cn("grid gap-2.5 mb-5", "grid-cols-3")}>
                  {googleSubServices.map((svc) => {
                    const platform = "platform" in svc ? svc.platform : undefined;
                    const platformHealth = platform ? googleHealth[platform] : undefined;
                    const healthStatus = platformHealth?.status;
                    const errorCode = platformHealth?.errorCode;
                    const AUTH_STALE_CODES = ["invalid_grant", "unauthorized_client"];
                    const needsReauth = healthStatus === "needs_reconnect" && (!errorCode || AUTH_STALE_CODES.includes(errorCode));
                    const probeError = healthStatus === "needs_reconnect" && !!errorCode && !AUTH_STALE_CODES.includes(errorCode);
                    const healthy = healthStatus === "healthy";
                    const connected = "badge" in svc && svc.badge;
                    const tile = (
                      <div
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-2xl relative w-full",
                          needsReauth ? "bg-error-container/40 ring-1 ring-rose-300" :
                          probeError  ? "bg-amber-50/60 ring-1 ring-amber-300" :
                          "bg-surface",
                        )}
                        title={
                          needsReauth
                            ? `${svc.label}: token ${errorCode ?? "invalid"} — click to re-authorize`
                            : probeError
                            ? `${svc.label}: probe failed (${errorCode}) — may be transient`
                            : healthy
                            ? `${svc.label}: healthy (refresh probe succeeded)`
                            : connected
                            ? `${svc.label}: connected — checking refresh…`
                            : `${svc.label}: not connected`
                        }
                      >
                        <span className={cn("material-symbols-outlined text-lg shrink-0", svc.color)}>{svc.icon}</span>
                        <span className="text-xs font-medium text-on-surface-variant truncate">{svc.label}</span>
                        {connected && !needsReauth && !probeError && healthy && (
                          <span className="absolute top-1 right-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[8px] font-bold uppercase tracking-wider border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Healthy
                          </span>
                        )}
                        {connected && !needsReauth && !probeError && !healthy && (
                          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
                        )}
                        {needsReauth && (
                          <span className="absolute top-1 right-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[8px] font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined" style={{ fontSize: 10 }}>warning</span>
                            Reconnect
                          </span>
                        )}
                        {probeError && (
                          <span className="absolute top-1 right-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[8px] font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined" style={{ fontSize: 10 }}>error_outline</span>
                            Error
                          </span>
                        )}
                      </div>
                    );
                    return needsReauth ? (
                      <button
                        key={svc.label}
                        type="button"
                        onClick={handleGoogleAuthorize}
                        className="text-left transition-transform active:scale-95"
                        title={`${svc.label} token ${errorCode ?? "invalid"} — click to re-authorize Google Workspace`}
                      >
                        {tile}
                      </button>
                    ) : (
                      <div key={svc.label}>{tile}</div>
                    );
                  })}
                </div>
                {workspaceNeedsReconnect && (
                  <button
                    onClick={handleGoogleAuthorize}
                    disabled={isGoogleConnecting}
                    className="w-full mb-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[14px]">link_off</span>
                    {isGoogleConnecting ? "Redirecting…" : "Google Workspace needs reconnect — re-authorize"}
                  </button>
                )}
                {isGoogleConnected && (gCalConnected || gDriveConnected || gDocsConnected) && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-2xl bg-[var(--color-brand-google)]/5 border border-[var(--color-brand-google)]/20">
                    <span className="material-symbols-outlined text-[var(--color-brand-google)] text-[16px]">info</span>
                    <span className="text-[10px] text-[var(--color-brand-google)]">
                      {[gCalConnected && "Calendar", gDriveConnected && "Drive", gDocsConnected && "Docs"].filter(Boolean).join(" · ")} scope{(([gCalConnected, gDriveConnected, gDocsConnected].filter(Boolean).length > 1) ? "s" : "")} active — extended workspace permissions granted
                    </span>
                  </div>
                )}
                <div className="mb-3 p-3 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-[16px] mt-0.5 shrink-0">security</span>
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    <span className="font-bold">Requires Admin or Standard access</span> to your Google Ads account. Calendar, Drive, and Docs use restricted OAuth scopes — only read access is requested for Docs and Drive.
                  </p>
                </div>
                {isGoogleConnected ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button
                        onClick={handleGoogleAdsSync}
                        disabled={googleAdsSyncing}
                        className="flex-1 py-2.5 bg-[#4285F4]/10 hover:bg-[#4285F4]/20 border border-[#4285F4]/30 text-blue-300 text-xs font-bold rounded-2xl transition-colors uppercase flex items-center justify-center gap-1.5"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                          {googleAdsSyncing ? "progress_activity" : "ads_click"}
                        </span>
                        {googleAdsSyncing ? "Syncing…" : "Sync Google Ads"}
                      </button>
                      <button
                        onClick={handleGoogleAuthorize}
                        disabled={isGoogleConnecting}
                        className="py-2.5 px-4 bg-surface hover:bg-surface-container-highest text-on-surface text-xs font-bold rounded-2xl transition-colors uppercase"
                      >
                        Settings
                      </button>
                      {isAdmin && (
                        <button
                          onClick={handleGoogleDisconnect}
                          className="py-2.5 px-4 border border-red-100 text-error-m3 text-xs font-bold rounded-2xl hover:bg-error-container transition-colors uppercase"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                    {gCalConnected && (
                      <button
                        onClick={handleScheduleSweep}
                        disabled={calendarCreating}
                        className="w-full py-2.5 bg-[#4285F4]/8 hover:bg-[#4285F4]/15 border border-[#4285F4]/25 text-[#4285F4] text-xs font-bold rounded-2xl transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {calendarCreating ? "progress_activity" : "calendar_add_on"}
                        </span>
                        {calendarCreating ? "Creating event…" : "Schedule 15-min Triage on Calendar"}
                      </button>
                    )}
                    {googleAdsSyncMsg && (
                      <p className="text-xs text-green-400 text-center py-1">✓ {googleAdsSyncMsg}</p>
                    )}
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleGoogleAuthorize}
                      disabled={isGoogleConnecting}
                      className="w-full py-2.5 bg-[#4285F4] hover:bg-[#3574e2] text-white text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <GoogleLogo className="w-4 h-4" />
                      {isGoogleConnecting ? "Redirecting…" : "Connect Google Workspace"}
                    </button>
                    <PrerequisiteHint text="Requires Admin or Standard access to your Google Ads account." inline />
                  </>
                )}
              </section>
            )}

            {(showAllSections || isSectionVisible("meta_ads", goal)) && (
              <section data-focus-platform="meta_ads" className="bg-white border ghost-border rounded-2xl p-6 shadow-sm data-[focused=true]:ring-4 data-[focused=true]:ring-[#2563EB]/40 data-[focused=true]:ring-offset-2 transition-all">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#0081FB]/5 border border-[#0081FB]/10 flex items-center justify-center">
                      <MetaLogo className="w-6 h-3.5" />
                    </div>
                    <div>
                      <h2 className="font-bold text-sm text-on-surface">Meta Ads</h2>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">Facebook · Instagram · Audience Network</p>
                    </div>
                  </div>
                  <HealthBadge connected={isMetaConnected} updatedAt={(metaConn as any)?.updatedAt} errorState={!!metaConn && (metaConn as any)?.isActive === false} />
                </div>
                <p className="text-xs text-on-surface-variant mb-4">Connect your Facebook and Instagram ad accounts to track ROI and ROAS in real-time.</p>
                <button
                  onClick={() => setIsMetaOAuthOpen(true)}
                  className="w-full py-2.5 bg-[#0081FB] hover:bg-[#0070e0] text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <MetaLogo className="w-5 h-3" />
                  {isMetaConnected ? "Re-authorize with Meta" : "Authorize with Meta"}
                </button>
                {!isMetaConnected && (
                  <PrerequisiteHint text="Requires Admin access to your Facebook Business Manager ad account." inline />
                )}
              </section>
            )}

            {(showAllSections || isSectionVisible("bing_ads", goal)) && (
              <section className={cn(
                "bg-white border ghost-border rounded-2xl p-6 shadow-sm",
                bingConnected && "border-l-4 border-l-teal-500",
              )}>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center">
                      <MicrosoftLogo className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-bold text-sm text-on-surface">Bing Ads</h2>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">Microsoft Advertising · Search · Audience Network</p>
                    </div>
                  </div>
                  <HealthBadge connected={bingConnected} updatedAt={(bingConn as any)?.updatedAt} errorState={!!bingConn && (bingConn as any)?.isActive === false} />
                </div>
                {bingConnected ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const apiBase = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
                        window.location.href = `${apiBase}/api/auth/bing/start`;
                      }}
                      className="flex-1 py-2.5 border border-outline-variant/15 text-on-surface text-xs font-bold rounded-2xl hover:bg-surface transition-colors uppercase"
                    >
                      Re-authorize
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-on-surface-variant mb-4">Connect your Microsoft Advertising account to track Bing search campaigns, audience performance, and cross-engine attribution.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const apiBase = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
                          window.location.href = `${apiBase}/api/auth/bing/start`;
                        }}
                        className="flex-1 py-2.5 bg-[#0078D4] hover:bg-[#006ABD] text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                      >
                        <MicrosoftLogo className="w-3.5 h-3.5" />
                        Authorize Microsoft Advertising
                      </button>
                      <button
                        onClick={() => setCredRequestPlatform("Bing Ads")}
                        className="py-2.5 px-4 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[14px]">support_agent</span>
                        Request IT Setup
                      </button>
                    </div>
                    <PrerequisiteHint text="Requires Admin or Standard access to your Microsoft Advertising account." inline />
                  </>
                )}
              </section>
            )}

            {(showAllSections || isSectionVisible("ad_channels", goal)) && (
              <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm md:col-span-2">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-2xl bg-[#010101]/5 border border-[#010101]/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px] text-on-surface">campaign</span>
                  </div>
                  <div>
                    <h2 className="font-bold text-sm text-on-surface">Additional Ad Channels</h2>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">TikTok · LinkedIn · Amazon — connect via API key</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      platform: "tiktok_ads", label: "TikTok Ads", icon: "tiktok_ads", color: "#010101",
                      iconNode: <span className="text-[18px] font-black text-[#010101]">T</span>,
                      desc: "TikTok campaigns, impressions, clicks, and conversion tracking.",
                      connected: tiktokConnected, conn: tiktokConn,
                      fields: [{ key: "accessToken", label: "Access Token", placeholder: "TikTok Ads API Access Token" }],
                    },
                    {
                      platform: "linkedin_ads", label: "LinkedIn Ads", icon: "linkedin_ads", color: "#0A66C2",
                      iconNode: <span className="text-[18px] font-black text-[#0A66C2]">in</span>,
                      desc: "LinkedIn sponsored content, InMail campaigns, and B2B attribution.",
                      connected: linkedinConnected, conn: linkedinConn,
                      fields: [
                        { key: "clientId", label: "Client ID", placeholder: "LinkedIn App Client ID", type: "text" },
                        { key: "clientSecret", label: "Client Secret", placeholder: "LinkedIn App Client Secret" },
                      ],
                    },
                    {
                      platform: "amazon_ads", label: "Amazon Ads", icon: "amazon_ads", color: "#FF9900",
                      iconNode: <span className="material-symbols-outlined text-[20px] text-[#FF9900]">shopping_bag</span>,
                      desc: "Sponsored Products, Brands, and Display campaigns on Amazon.",
                      connected: amazonConnected, conn: amazonConn,
                      fields: [
                        { key: "clientId", label: "Client ID", placeholder: "Amazon Ads Client ID", type: "text" },
                        { key: "clientSecret", label: "Client Secret", placeholder: "Amazon Ads Client Secret" },
                        { key: "profileId", label: "Profile ID", placeholder: "Advertiser Profile ID", type: "text", hint: "Found in Amazon Ads console under Account Settings." },
                      ],
                    },
                  ].map((svc) => (
                    <div key={svc.platform} className={cn(
                      "rounded-2xl border p-4 transition-all",
                      svc.connected ? "border-emerald-300 bg-emerald-50/30" : "ghost-border bg-surface hover:shadow-sm",
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${svc.color}15`, border: `1px solid ${svc.color}25` }}>
                            {svc.iconNode}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface">{svc.label}</p>
                            <p className="text-[10px] text-on-surface-variant">{svc.desc}</p>
                          </div>
                        </div>
                        {svc.connected && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                            </span>
                            Connected
                          </span>
                        )}
                      </div>
                      {svc.connected ? (
                        <div className="flex gap-2">
                          {(svc.conn as any)?.updatedAt && (
                            <span className="flex-1 text-[10px] text-on-surface-variant self-center">Last synced: {timeAgo((svc.conn as any)?.updatedAt)}</span>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleSimpleDisconnect(svc.platform, svc.label)}
                              className="py-2 px-4 border border-red-100 text-error-m3 text-xs font-bold rounded-xl hover:bg-error-container transition-colors uppercase"
                            >
                              Disconnect
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => setApiKeyModal({
                            platform: svc.platform, title: svc.label, color: svc.color, fields: svc.fields,
                          })}
                          className="w-full py-2.5 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                          style={{ background: svc.color }}
                        >
                          <span className="material-symbols-outlined text-[14px]">link</span>
                          Connect {svc.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(showAllSections || isSectionVisible("shopify", goal)) && (
              <section
                data-focus-platform="shopify"
                className={cn(
                  "bg-white border ghost-border rounded-2xl p-6 shadow-sm md:col-span-2 data-[focused=true]:ring-4 data-[focused=true]:ring-[#2563EB]/40 data-[focused=true]:ring-offset-2 transition-all",
                  isShopifyConnected && "border-l-4 border-l-[#96bf48]",
                )}
              >
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#96bf48]/10 border border-[#96bf48]/20 flex items-center justify-center">
                      <ShopifyLogo className="w-5 h-6" />
                    </div>
                    <div>
                      <h2 className="font-bold text-sm text-on-surface">Shopify</h2>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">Orders · Products · Revenue</p>
                    </div>
                  </div>
                  <HealthBadge connected={!!isShopifyConnected} updatedAt={(shopifyConn as any)?.updatedAt} errorState={!!shopifyConn && (shopifyConn as any)?.isActive === false} />
                </div>
                {isShopifyConnected ? (
                  <>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-[#96bf48]/10 rounded-2xl flex items-center justify-center border border-[#96bf48]/20">
                        <ShopifyLogo className="w-6 h-7" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface">{shopifyDomain}</p>
                        <p className="text-xs text-[#96bf48] font-medium">Active Connection</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsShopifyOAuthOpen(true)}
                        className="flex-1 py-2.5 border border-outline-variant/15 text-on-surface text-xs font-bold rounded-2xl hover:bg-surface transition-colors uppercase"
                      >
                        Re-authorize
                      </button>
                      {isAdmin && (
                        <button
                          onClick={handleShopifyDisconnect}
                          className="flex-1 py-2.5 border border-red-100 text-error-m3 text-xs font-bold rounded-2xl hover:bg-error-container transition-colors uppercase"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-on-surface-variant mb-4">Connect your Shopify store to sync orders, products, and revenue data.</p>
                    <button
                      onClick={() => setIsShopifyOAuthOpen(true)}
                      className="w-full py-2.5 bg-[#96bf48] hover:bg-[#7da93c] text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                      <ShopifyLogo className="w-4 h-5" />
                      Authorize with Shopify
                    </button>
                    <PrerequisiteHint text="Requires Store Owner permissions to approve read/write scopes." inline />
                  </>
                )}
              </section>
            )}

            {(showAllSections || isSectionVisible("woocommerce", goal)) && (
              <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#7F54B3]/10 border border-[#7F54B3]/20 flex items-center justify-center">
                      <WooCommerceLogo className="w-6 h-4" />
                    </div>
                    <div>
                      <h2 className="font-bold text-sm text-on-surface">WooCommerce</h2>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">REST API · Products · Orders</p>
                    </div>
                  </div>
                  <HealthBadge connected={isWooConnected} updatedAt={(wooConn as any)?.updatedAt} errorState={!!wooConn && (wooConn as any)?.isActive === false} />
                </div>
                <p className="text-xs text-on-surface-variant mb-4">Connect your WooCommerce store to sync products, orders, and customer data via REST API.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsWooModalOpen(true)}
                    className="flex-1 py-2.5 bg-[#7F54B3] hover:bg-[#6b459a] text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <WooCommerceLogo className="w-5 h-3" />
                    Connect
                  </button>
                  <button
                    onClick={() => setCredRequestPlatform("WooCommerce")}
                    className="py-2.5 px-4 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[14px]">support_agent</span>
                    Request IT Setup
                  </button>
                </div>
              </section>
            )}

            {(showAllSections || isSectionVisible("crm", goal)) && (
              <div data-focus-platform="crm" className="md:col-span-2 flex flex-col gap-4 data-[focused=true]:ring-4 data-[focused=true]:ring-[#2563EB]/40 data-[focused=true]:ring-offset-2 data-[focused=true]:rounded-2xl transition-all">
                <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-surface border ghost-border flex items-center justify-center">
                      <span className="material-symbols-outlined text-on-surface-variant text-xl">groups</span>
                    </div>
                    <div>
                      <h2 className="font-bold text-sm text-on-surface">CRM &amp; Pipeline</h2>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">Leads · Contacts · Pipeline attribution</p>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant mb-5">Connect your CRM to sync offline conversions, leads, and pipeline data for full-funnel attribution.</p>

                  <div className="space-y-4">
                    <div className={cn(
                      "rounded-2xl border p-5 transition-all",
                      salesforceConnected
                        ? "border-[#00A1E0]/30 bg-[#00A1E0]/[0.03]"
                        : "ghost-border bg-white hover:border-[#00A1E0]/30 hover:shadow-sm",
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-[#00A1E0]/10 border border-[#00A1E0]/20 flex items-center justify-center">
                            <SalesforceLogo className="w-6 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface">Salesforce</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">Sync offline conversions, Leads, and Opportunities.</p>
                          </div>
                        </div>
                        {salesforceConnected ? (
                          <div className="flex items-center gap-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                              Connected
                            </span>
                            {(salesforceConn as any)?.updatedAt && <span className="text-[10px] text-on-surface-variant font-medium">Last Synced: {timeAgo((salesforceConn as any)?.updatedAt)}</span>}
                          </div>
                        ) : null}
                      </div>
                      {!salesforceConnected && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              window.location.href = `${API_BASE}api/auth/salesforce/start`;
                            }}
                            className="flex-1 py-2.5 bg-[#00A1E0] hover:bg-[#0090cc] text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                          >
                            <SalesforceLogo className="w-5 h-3.5" />
                            Authorize Salesforce
                          </button>
                          <button
                            onClick={() => setCredRequestPlatform("Salesforce")}
                            className="py-2.5 px-4 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[14px]">support_agent</span>
                            Request IT Setup
                          </button>
                        </div>
                      )}
                    </div>

                    <div className={cn(
                      "rounded-2xl border p-5 transition-all",
                      hubspotConnected
                        ? "border-[#FF7A59]/30 bg-[#FF7A59]/[0.03]"
                        : "ghost-border bg-white hover:border-[#FF7A59]/30 hover:shadow-sm",
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-[#FF7A59]/10 border border-[#FF7A59]/20 flex items-center justify-center">
                            <HubSpotLogo className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface">HubSpot</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">Sync CRM contacts, deal stages, and MQL tracking.</p>
                          </div>
                        </div>
                        {hubspotConnected ? (
                          <div className="flex items-center gap-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                              Connected
                            </span>
                            {(hubspotConn as any)?.updatedAt && <span className="text-[10px] text-on-surface-variant font-medium">Last Synced: {timeAgo((hubspotConn as any)?.updatedAt)}</span>}
                          </div>
                        ) : null}
                      </div>
                      {!hubspotConnected && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              window.location.href = `${API_BASE}api/auth/hubspot/start`;
                            }}
                            className="flex-1 py-2.5 bg-[#FF7A59] hover:bg-[#e86a4a] text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                          >
                            <HubSpotLogo className="w-5 h-5" />
                            Authorize HubSpot
                          </button>
                          <button
                            onClick={() => setCredRequestPlatform("HubSpot")}
                            className="py-2.5 px-4 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[14px]">support_agent</span>
                            Request IT Setup
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border ghost-border bg-white p-5 hover:border-[#241C15]/20 hover:shadow-sm transition-all">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-2xl bg-[#FFE01B]/20 border border-[#FFE01B]/30 flex items-center justify-center">
                          <MailchimpLogo className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface">Mailchimp</p>
                          <p className="text-[10px] text-on-surface-variant mt-0.5">Email campaigns, audience segments, and engagement data.</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setCredRequestPlatform("Mailchimp")}
                        className="w-full py-2.5 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[14px]">support_agent</span>
                        Request IT Setup
                      </button>
                    </div>

                    <div className={cn(
                      "rounded-2xl border p-5 transition-all",
                      zohoConnected
                        ? "border-red-300 bg-red-50/30"
                        : "ghost-border bg-white hover:border-red-300 hover:shadow-sm",
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
                            <span className="material-symbols-outlined text-xl text-red-600">contact_page</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface">Zoho CRM</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">Leads, contacts, deals, and pipeline attribution.</p>
                          </div>
                        </div>
                        {zohoConnected ? (
                          <div className="flex items-center gap-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                              Connected
                            </span>
                          </div>
                        ) : null}
                      </div>
                      {!zohoConnected && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              window.location.href = `${API_BASE}api/auth/zoho/start`;
                            }}
                            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                          >
                            <span className="material-symbols-outlined text-sm">contact_page</span>
                            Authorize Zoho
                          </button>
                          <button
                            onClick={() => setCredRequestPlatform("Zoho CRM")}
                            className="py-2.5 px-4 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[14px]">support_agent</span>
                            Request IT Setup
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <PrerequisiteHint text="Ensure your CRM plan includes API access for data synchronization." inline />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setPipelineModalPlatform("HubSpot / Salesforce")}
                      className="flex-1 py-2.5 bg-primary-container hover:bg-primary-m3 text-white text-xs font-semibold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">account_tree</span>
                      Configure Pipeline
                    </button>
                    <button
                      onClick={() => setCredRequestPlatform("CRM / Pipeline")}
                      className="flex-1 py-2.5 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface hover:border-[#c8c5cb] transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">support_agent</span>
                      Request IT Setup
                    </button>
                  </div>
                </section>
              </div>
            )}

            {(showAllSections || isSectionVisible("ops_finance", goal)) && (
              <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm md:col-span-2">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-2xl bg-[#4A154B]/5 border border-[#4A154B]/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px] text-[#4A154B]">hub</span>
                  </div>
                  <div>
                    <h2 className="font-bold text-sm text-on-surface">Ops & Finance</h2>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">Slack · Stripe · Klaviyo — alerts, revenue, and email automation</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      platform: "slack", label: "Slack", color: "#4A154B",
                      iconNode: <span className="material-symbols-outlined text-[20px] text-[#4A154B]">forum</span>,
                      desc: "Receive alert notifications directly in your Slack workspace.",
                      connected: slackConnected, conn: slackConn,
                      fields: [{ key: "webhookUrl", label: "Incoming Webhook URL", placeholder: "https://hooks.slack.com/services/...", type: "text", hint: "Create one at api.slack.com → Your Apps → Incoming Webhooks." }],
                    },
                    {
                      platform: "stripe", label: "Stripe", color: "#635BFF",
                      iconNode: <span className="material-symbols-outlined text-[20px] text-[#635BFF]">payments</span>,
                      desc: "Revenue, subscriptions, MRR, churn, and payment analytics.",
                      connected: stripeConnected, conn: stripeConn,
                      fields: [{ key: "secretKey", label: "Secret Key", placeholder: "sk_live_..." , hint: "Use a restricted key with read-only permissions." }],
                    },
                    {
                      platform: "klaviyo", label: "Klaviyo", color: "#06C167",
                      iconNode: <span className="material-symbols-outlined text-[20px] text-[#06C167]">mail</span>,
                      desc: "Email flow performance, list growth, and customer lifetime value.",
                      connected: klaviyoConnected, conn: klaviyoConn,
                      fields: [{ key: "apiKey", label: "Private API Key", placeholder: "pk_...", hint: "Found in Klaviyo Account → Settings → API Keys." }],
                    },
                  ].map((svc) => (
                    <div key={svc.platform} className={cn(
                      "rounded-2xl border p-4 transition-all",
                      svc.connected ? "border-emerald-300 bg-emerald-50/30" : "ghost-border bg-surface hover:shadow-sm",
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${svc.color}15`, border: `1px solid ${svc.color}25` }}>
                            {svc.iconNode}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface">{svc.label}</p>
                            <p className="text-[10px] text-on-surface-variant">{svc.desc}</p>
                          </div>
                        </div>
                        {svc.connected && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                            </span>
                            Connected
                          </span>
                        )}
                      </div>
                      {svc.connected ? (
                        <div className="flex gap-2">
                          {(svc.conn as any)?.updatedAt && (
                            <span className="flex-1 text-[10px] text-on-surface-variant self-center">Last synced: {timeAgo((svc.conn as any)?.updatedAt)}</span>
                          )}
                          {svc.platform === "slack" && (
                            <button
                              onClick={handleSlackTest}
                              disabled={slackTestResult === "sending"}
                              className={cn(
                                "py-2 px-4 text-xs font-bold rounded-xl transition-colors",
                                slackTestResult === "ok" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                                slackTestResult === "error" ? "bg-red-50 text-error-m3 border border-red-200" :
                                "border border-[#4A154B]/20 text-[#4A154B] hover:bg-[#4A154B]/5",
                              )}
                            >
                              {slackTestResult === "sending" ? "Sending…" : slackTestResult === "ok" ? "Sent ✓" : slackTestResult === "error" ? "Error ✗" : "Send Test"}
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleSimpleDisconnect(svc.platform, svc.label)}
                              className="py-2 px-4 border border-red-100 text-error-m3 text-xs font-bold rounded-xl hover:bg-error-container transition-colors uppercase"
                            >
                              Disconnect
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => setApiKeyModal({
                            platform: svc.platform, title: svc.label, color: svc.color, fields: svc.fields,
                          })}
                          className="w-full py-2.5 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                          style={{ background: svc.color }}
                        >
                          <span className="material-symbols-outlined text-[14px]">link</span>
                          Connect {svc.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <LookerEmbedCard />

            <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-primary-container/10 border border-primary-container/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary-m3 text-xl">storage</span>
                </div>
                <div>
                  <h2 className="font-bold text-sm text-on-surface">Data Warehouses &amp; Databases</h2>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">Connect your own database for AI-powered analysis</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary-container/10 text-primary-m3 text-[9px] font-bold uppercase tracking-widest border border-primary-container/20">
                  BYODB
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mb-5">Connect your existing data warehouses directly. Our AI can query your data models natively for custom analysis.</p>

              {byodbCredentials.length > 0 && (
                <div className="space-y-2 mb-5">
                  {byodbCredentials.map((cred) => (
                    <div key={cred.id} className="rounded-xl border ghost-border p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold",
                          cred.dbType === "postgres" ? "bg-[#336791]" : cred.dbType === "mysql" ? "bg-[#00758F]" : cred.dbType === "snowflake" ? "bg-[#29B5E8]" : "bg-[#4285F4]"
                        )}>
                          {cred.dbType === "postgres" ? "PG" : cred.dbType === "mysql" ? "My" : cred.dbType === "snowflake" ? "SF" : "BQ"}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-on-surface">{cred.label || cred.databaseName}</p>
                          <p className="text-[10px] text-on-surface-variant">{cred.host} &middot; {cred.databaseName}</p>
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                        cred.status === "connected" ? "bg-green-50 text-green-700" : cred.status === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                      )}>
                        {cred.status === "connected" ? "Connected" : cred.status === "error" ? "Error" : "Pending"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {([
                  { type: "postgres" as const, label: "PostgreSQL", color: "#336791", abbr: "PG", ready: true },
                  { type: "mysql" as const, label: "MySQL", color: "#00758F", abbr: "My", ready: false },
                  { type: "snowflake" as const, label: "Snowflake", color: "#29B5E8", abbr: "SF", ready: false },
                  { type: "bigquery" as const, label: "BigQuery", color: "#4285F4", abbr: "BQ", ready: false },
                ]).map((db) => (
                  <button
                    key={db.type}
                    onClick={() => db.ready && setByodbType(db.type)}
                    disabled={!db.ready}
                    className={cn(
                      "rounded-xl border ghost-border p-3 flex items-center gap-2.5 transition-all text-left group",
                      db.ready ? "hover:border-primary-m3/30 hover:shadow-sm cursor-pointer" : "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: db.color }}>
                      {db.abbr}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-on-surface">{db.label}</p>
                      <p className="text-[10px] text-on-surface-variant">{db.ready ? "Connect" : "Coming soon"}</p>
                    </div>
                    {db.ready ? (
                      <span className="material-symbols-outlined text-on-surface-variant/50 text-sm group-hover:text-primary-m3 transition-colors">add_circle</span>
                    ) : (
                      <span className="text-[9px] font-bold text-on-surface-variant/50 uppercase">Soon</span>
                    )}
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-surface border ghost-border flex items-center justify-center">
                  <span className="material-symbols-outlined text-on-surface-variant text-xl">database</span>
                </div>
                <div>
                  <h2 className="font-bold text-sm text-on-surface">Data Lake &amp; Warehouse</h2>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">Export · Sync · Enterprise BI</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[9px] font-bold uppercase tracking-widest border border-violet-200/40">
                  Enterprise
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mb-5">Push enriched campaign, revenue, and pipeline data to your cloud data warehouse for advanced BI and ML workflows.</p>

              <div className="space-y-4">
                <div className="rounded-2xl border ghost-border bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-[#29B5E8]/10 border border-[#29B5E8]/20 flex items-center justify-center">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <path d="M12.394 21.001l-.002-.024-.009-.112a2.673 2.673 0 0 1 .016-.434 2.52 2.52 0 0 1 .19-.672l2.5-5.777L24 12.005l-8.91-1.977-2.501-5.777a2.52 2.52 0 0 1-.19-.672 2.673 2.673 0 0 1-.006-.546l.002-.024.009-.112c.01-.126.024-.237.048-.34L12 1l-.447 1.556c.024.104.038.215.048.341l.009.112.002.024a2.673 2.673 0 0 1-.016.434 2.52 2.52 0 0 1-.19.672L8.905 9.916l-.003.002L0 12.005l8.91 1.977 2.501 5.777c.09.208.153.432.19.672.027.173.026.35.016.434l-.009.112-.002.024-.009.112c-.01.126-.024.237-.048.34L12 23l.447-1.556a3.45 3.45 0 0 1-.048-.341l-.005-.102z" fill="#29B5E8"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface">Snowflake</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">Export campaign &amp; revenue data to Snowflake warehouse.</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative group">
                    <button
                      disabled
                      className="w-full py-2.5 bg-[#29B5E8]/8 text-[#29B5E8]/50 text-xs font-bold rounded-2xl flex items-center justify-center gap-2 cursor-not-allowed border border-[#29B5E8]/15"
                    >
                      <span className="material-symbols-outlined text-[14px]">link</span>
                      Connect Snowflake
                    </button>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-on-surface text-white text-[10px] font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
                      Enterprise feature: Contact sales to enable data lake exporting
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-on-surface" />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border ghost-border bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-[#FF3621]/10 border border-[#FF3621]/20 flex items-center justify-center">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <path d="M20.16 4.676l-4.038-2.16L12 6.707 7.878 2.516 3.84 4.676 7.878 8.8v6.4L3.84 19.324l4.038 2.16L12 17.293l4.122 4.191 4.038-2.16L16.122 15.2V8.8l4.038-4.124z" fill="#FF3621"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface">Databricks</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">Lakehouse analytics, Delta Lake sync &amp; ML pipelines.</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative group">
                    <button
                      disabled
                      className="w-full py-2.5 bg-[#FF3621]/8 text-[#FF3621]/50 text-xs font-bold rounded-2xl flex items-center justify-center gap-2 cursor-not-allowed border border-[#FF3621]/15"
                    >
                      <span className="material-symbols-outlined text-[14px]">link</span>
                      Connect Databricks
                    </button>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-on-surface text-white text-[10px] font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg">
                      Enterprise feature: Contact sales to enable data lake exporting
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-on-surface" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

          </div>
        )}
      </div>

      <WooCommerceModal
        open={isWooModalOpen}
        onClose={() => setIsWooModalOpen(false)}
        onConnect={handleWooConnect}
        saving={wooSaving}
      />

      <ApiKeyModal
        config={apiKeyModal}
        onClose={() => setApiKeyModal(null)}
        onConnect={handleApiKeyConnect}
        saving={apiKeySaving}
      />

      <ShopifyOAuthDialog isOpen={isShopifyOAuthOpen} onOpenChange={setIsShopifyOAuthOpen} />

      <MetaOAuthDialog isOpen={isMetaOAuthOpen} onOpenChange={setIsMetaOAuthOpen} />

      {workspaceSetupKey && (
        <GoogleWorkspaceSetupDialog
          setupKey={workspaceSetupKey}
          email={workspaceSetupEmail}
          isOpen={isWorkspaceSetupOpen}
          onOpenChange={setIsWorkspaceSetupOpen}
          onComplete={() => queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() })}
        />
      )}

      {metaSetupKey && (
        <MetaSetupDialog
          setupKey={metaSetupKey}
          email={metaSetupEmail}
          isOpen={isMetaSetupOpen}
          onOpenChange={setIsMetaSetupOpen}
          onComplete={() => queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() })}
        />
      )}

      {connError && (
        <ConnectionFailedModal
          platform={connError.platform}
          errorCode={connError.code}
          onClose={() => setConnError(null)}
          onRetry={() => {
            const p = connError.platform;
            setConnError(null);
            if (p === "google_ads") handleGoogleAuthorize();
            else if (p === "shopify") setIsShopifyOAuthOpen(true);
            else if (p === "meta") setIsMetaOAuthOpen(true);
            else if (p === "hubspot") window.location.href = `${API_BASE}api/auth/hubspot/start`;
            else if (p === "salesforce") window.location.href = `${API_BASE}api/auth/salesforce/start`;
            else if (p === "bing_ads") { const apiBase = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE; window.location.href = `${apiBase}/api/auth/bing/start`; }
            else if (p === "zoho") window.location.href = `${API_BASE}api/auth/zoho/start`;
          }}
        />
      )}

      <CredentialRequestModal
        open={!!credRequestPlatform}
        onClose={() => setCredRequestPlatform(null)}
        platform={credRequestPlatform || ""}
      />

      <CrmPipelineMappingModal
        open={!!pipelineModalPlatform}
        onClose={() => setPipelineModalPlatform(null)}
        crmPlatform={pipelineModalPlatform || ""}
      />

      {byodbType && (
        <DbConnectModal
          open={!!byodbType}
          dbType={byodbType}
          onClose={() => setByodbType(null)}
          onConnected={() => {
            authFetch(`${API_BASE}api/byodb/credentials`)
              .then((r) => (r.ok ? r.json() : []))
              .then((data) => setByodbCredentials(data))
              .catch((err) => {
                console.error("[Connections] Failed to refresh BYODB credentials after connect:", err);
                toast({
                  title: "Connection saved, but the list didn't refresh",
                  description: "Reload the page to see your new warehouse connection.",
                  variant: "destructive",
                });
              });
          }}
        />
      )}

      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => { if (!open) setConfirmDialog((prev) => ({ ...prev, open: false })); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmDialog.onConfirm(); setConfirmDialog((prev) => ({ ...prev, open: false })); }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
