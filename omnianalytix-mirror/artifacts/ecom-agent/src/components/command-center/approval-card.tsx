import { useState } from "react";
import { AlertTriangle, RotateCcw, Loader2, CheckCircle2, XCircle, Clock, ChevronDown, TrendingUp, TrendingDown, Minus, ShieldAlert, Lock, Zap, Package, DollarSign, Eye } from "lucide-react";
import { SiGoogleads, SiMeta, SiShopify, SiGoogle } from "react-icons/si";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserRole, canApproveImpact, ROLE_LABELS, ROLE_COLORS, IMPACT_COLORS, REQUIRED_ROLE_FOR_IMPACT, type ImpactLevel } from "@/contexts/user-role-context";
import { MoneyTile } from "@/components/ui/money-tile";

export type DiffRow = { label: string; from: string; to: string };

export type ApprovalStatus = "pending" | "executing" | "executed" | "rejected" | "reverted" | "revert_failed" | "failed";

export interface ApprovalCardData {
  snapshotId: number;
  platform: string;
  platformLabel: string;
  toolName: string;
  toolDisplayName: string;
  toolArgs: Record<string, unknown>;
  displayDiff: DiffRow[];
  reasoning: string;
  status: ApprovalStatus;
  executionMessage?: string;
}

interface ApprovalCardProps {
  card: ApprovalCardData;
  onApprove: (snapshotId: number) => Promise<void>;
  onApproveRequest?: (snapshotId: number) => void;
  onReject: (snapshotId: number) => Promise<void>;
  onRevert: (snapshotId: number) => Promise<void>;
  onProposeFix?: (card: ApprovalCardData, comments: string) => Promise<void>;
  onPreview?: (snapshotId: number) => Promise<{ success: boolean; message: string }>;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  google_ads: <SiGoogleads className="w-3.5 h-3.5 text-[#60a5fa]" />,
  meta:       <SiMeta      className="w-3.5 h-3.5 text-[#1877F2]" />,
  shopify:    <SiShopify   className="w-3.5 h-3.5 text-emerald-400" />,
  gmc:        <SiGoogle    className="w-3.5 h-3.5 text-rose-400" />,
  gsc:        <Search      className="w-3.5 h-3.5 text-emerald-400" />,
};

const PLATFORM_GLOW: Record<string, string> = {
  google_ads: "border-primary-container/40  shadow-[0_0_0_1px_rgba(59,130,246,0.15)]",
  meta:       "border-amber-500/40 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]",
  shopify:    "border-emerald-500/40 shadow-[0_0_0_1px_rgba(34,197,94,0.12)]",
  gmc:        "border-rose-500/40   shadow-[0_0_0_1px_rgba(239,68,68,0.12)]",
  gsc:        "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
};

const STATUS_CONFIG: Record<ApprovalStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  pending:      { label: "AWAITING APPROVAL", icon: <Clock className="w-2.5 h-2.5" />,        cls: "text-amber-400  border-amber-500/40  bg-amber-500/10"  },
  executing:    { label: "EXECUTING…",        icon: <Loader2 className="w-2.5 h-2.5 animate-spin" />, cls: "text-accent-blue border-cyan-500/40 bg-accent-blue/10" },
  executed:     { label: "EXECUTED",          icon: <CheckCircle2 className="w-2.5 h-2.5" />, cls: "text-emerald-400  border-emerald-500/40  bg-emerald-500/10"  },
  rejected:     { label: "REJECTED",          icon: <XCircle className="w-2.5 h-2.5" />,      cls: "text-on-surface-variant   border-outline-variant/15       bg-surface/60"   },
  reverted:     { label: "REVERTED",          icon: <RotateCcw className="w-2.5 h-2.5" />,    cls: "text-purple-400 border-purple-500/40  bg-purple-500/10" },
  revert_failed:{ label: "REVERT FAILED",     icon: <XCircle className="w-2.5 h-2.5" />,      cls: "text-rose-400    border-rose-500/40     bg-error-container/10"    },
  failed:       { label: "FAILED",            icon: <XCircle className="w-2.5 h-2.5" />,      cls: "text-rose-400    border-rose-500/40     bg-error-container/10"    },
};

function utcTime() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" }) + " UTC";
}

// ─── Delta classifier ─────────────────────────────────────────────────────────
// Returns "increase" | "decrease" | "status" | "neutral" for a diff row.

function classifyDelta(row: DiffRow): "increase" | "decrease" | "status" | "neutral" {
  if (row.from === "—" || row.to === "—") return "neutral";
  const fromNum = parseFloat(row.from.replace(/[^0-9.]/g, ""));
  const toNum   = parseFloat(row.to.replace(/[^0-9.]/g, ""));
  if (!isNaN(fromNum) && !isNaN(toNum) && fromNum !== toNum) {
    return toNum > fromNum ? "increase" : "decrease";
  }
  if (/status|state|enabled|paused|active|draft|archived/i.test(row.label)) return "status";
  return "neutral";
}

// ─── Impact sentence derivation ───────────────────────────────────────────────

function deriveImpactSentence(card: ApprovalCardData): string {
  const diff = card.displayDiff;

  // Try numeric delta rows first
  for (const row of diff) {
    const fromNum = parseFloat(row.from.replace(/[^0-9.]/g, ""));
    const toNum   = parseFloat(row.to.replace(/[^0-9.]/g, ""));
    if (!isNaN(fromNum) && !isNaN(toNum) && fromNum !== toNum) {
      const dir = toNum > fromNum ? "increases" : "decreases";
      const pct = Math.abs(((toNum - fromNum) / fromNum) * 100).toFixed(0);
      return `This mutation ${dir} ${row.label.toLowerCase()} by ${pct}% on ${card.platformLabel}.`;
    }
  }

  // Status change
  const statusRow = diff.find((r) => /status|state|enabled|paused|active/i.test(r.label));
  if (statusRow) {
    return `Operational status change on ${card.platformLabel} — confirm intent before deploying.`;
  }

  // Fall back to first sentence of reasoning
  const first = card.reasoning.split(/[.!?]\s+/)[0]?.trim();
  return first ? `${first}.` : `Execute ${card.toolDisplayName} on ${card.platformLabel}.`;
}

// ─── Impact level classifier ──────────────────────────────────────────────────

const HIGH_TOOLS = [
  "patch_campaign_budget", "create_campaign", "pause_campaign", "enable_campaign",
  "delete_campaign", "delete_ad_group", "edit_theme_colors", "update_discount",
  "create_discount", "shopify_updateThemeColors",
];
const MEDIUM_TOOLS = [
  "patch_bid_adjustment", "create_metafield", "update_product", "patch_ad_status",
  "shopify_patchProduct", "google_ads_patchBid", "resolve_google_ad_disapproval",
  "resolve_meta_ad_disapproval", "patch_gmc_product",
];

function computeImpactLevel(card: ApprovalCardData): ImpactLevel {
  const tool = card.toolName.toLowerCase();
  if (HIGH_TOOLS.some((t) => tool.includes(t.toLowerCase()))) return "HIGH";
  if (MEDIUM_TOOLS.some((t) => tool.includes(t.toLowerCase()))) return "MEDIUM";
  // Check delta size for any budget/spend row
  for (const row of card.displayDiff) {
    if (/budget|spend|cost/i.test(row.label)) {
      const from = parseFloat(row.from.replace(/[^0-9.]/g, ""));
      const to   = parseFloat(row.to.replace(/[^0-9.]/g, ""));
      if (!isNaN(from) && !isNaN(to)) {
        const delta = Math.abs(to - from);
        if (delta > 5000) return "HIGH";
        if (delta > 500)  return "MEDIUM";
      }
    }
  }
  // Any write tool → MEDIUM by default; read tools → LOW
  if (/patch|create|update|delete|resolve|edit|set|enable|pause/i.test(tool)) return "MEDIUM";
  return "LOW";
}

// ─── DiffRow visual ───────────────────────────────────────────────────────────

function DiffLine({ row }: { row: DiffRow }) {
  const delta = classifyDelta(row);
  const hasBoth = row.from !== "—" && row.to !== "—" && row.from !== row.to;

  const deltaColors = {
    increase: { arrow: "text-emerald-400", value: "text-green-300", bg: "bg-emerald-500/8" },
    decrease: { arrow: "text-rose-400",   value: "text-red-300",   bg: "bg-error-container/8"   },
    status:   { arrow: "text-amber-400", value: "text-amber-300", bg: "bg-amber-500/8" },
    neutral:  { arrow: "text-on-surface-variant",  value: "text-on-surface-variant",  bg: ""               },
  }[delta];

  const DeltaIcon = delta === "increase"
    ? TrendingUp
    : delta === "decrease"
    ? TrendingDown
    : Minus;

  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5 rounded-md", hasBoth && deltaColors.bg)}>
      {/* Label */}
      <span className="text-[10px] font-mono text-on-surface-variant w-32 shrink-0 truncate uppercase tracking-wider">
        {row.label}
      </span>

      {/* From → To */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {hasBoth ? (
          <>
            <span className="text-sm font-mono font-bold text-on-surface-variant line-through decoration-on-surface-variant">
              {row.from}
            </span>
            <DeltaIcon className={cn("w-3.5 h-3.5 shrink-0", deltaColors.arrow)} />
            <span className={cn("text-sm font-mono font-bold", deltaColors.value)}>
              {row.to}
            </span>
          </>
        ) : row.from !== "—" ? (
          <span className="text-sm font-mono font-bold text-on-surface-variant">{row.from}</span>
        ) : (
          <span className={cn("text-sm font-mono font-bold", deltaColors.value)}>{row.to}</span>
        )}
      </div>

      {/* Delta badge */}
      {hasBoth && (() => {
        const fromNum = parseFloat(row.from.replace(/[^0-9.]/g, ""));
        const toNum   = parseFloat(row.to.replace(/[^0-9.]/g, ""));
        if (!isNaN(fromNum) && !isNaN(toNum) && fromNum !== 0) {
          const pct = ((toNum - fromNum) / fromNum * 100).toFixed(1);
          return (
            <span className={cn(
              "shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border",
              delta === "increase"
                ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                : delta === "decrease"
                ? "border-rose-500/30 text-rose-400 bg-error-container/10"
                : "border-outline-variant/15 text-on-surface-variant",
            )}>
              {toNum > fromNum ? "+" : ""}{pct}%
            </span>
          );
        }
        return null;
      })()}
    </div>
  );
}

// ─── Promo Intelligence Card variant ──────────────────────────────────────────

function PromoApprovalCard({ card, onApprove, onReject, onApproveRequest }: {
  card: ApprovalCardData;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  onApproveRequest?: (id: number) => void;
}) {
  const [isActing, setIsActing] = useState(false);
  const { currentUser } = useUserRole();
  // Recovery now renders via <MoneyTile> so users get a hover audit trail
  // of the underlying USD value, the FX rate used, and the rate source.

  const productTitle = String(card.toolArgs?.productTitle ?? card.toolDisplayName ?? "Product");
  const promoCode    = String(card.toolArgs?.promoCode ?? "To be generated");
  const recovery     = parseFloat(String(card.toolArgs?.projectedRecovery ?? "0"));
  const invRow       = card.displayDiff.find((r) => r.label === "Inventory");
  const poasRow      = card.displayDiff.find((r) => r.label === "7-Day Avg POAS");
  const statusCfg    = STATUS_CONFIG[card.status];

  const handle = async (action: "approve" | "reject") => {
    setIsActing(true);
    try {
      if (action === "approve") {
        if (onApproveRequest) { onApproveRequest(card.snapshotId); return; }
        await onApprove(card.snapshotId);
      } else {
        await onReject(card.snapshotId);
      }
    } finally {
      setIsActing(false);
    }
  };

  const isTerminal = ["executed", "rejected", "reverted"].includes(card.status);
  const isPending  = card.status === "pending";

  return (
    <div className="mx-4 my-3 rounded-2xl border overflow-hidden bg-white border-orange-200 shadow-[0_0_0_1px_rgba(249,115,22,0.12)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-rose-50">
        <Zap className="w-4 h-4 text-orange-500 shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-mono text-orange-600 uppercase tracking-widest font-bold">
            Promo Intelligence Engine
          </span>
          <span className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono",
            statusCfg.cls,
          )}>
            {statusCfg.icon}
            {statusCfg.label}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono text-orange-600 border-orange-300 bg-orange-50">
            <ShieldAlert className="w-2.5 h-2.5" />
            HIGH IMPACT
          </span>
          <span className="ml-auto text-[9px] font-mono text-on-surface-variant">
            #{Math.abs(card.snapshotId)} · CRON
          </span>
        </div>
      </div>

      {/* What */}
      <div className="px-4 pt-4 pb-3 border-b border-orange-50">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">Zone 1 · Liquidate Stock</span>
          <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-600">
            <SiShopify className="w-3.5 h-3.5" />
            Shopify + Google Ads
          </span>
        </div>
        <h3 className="text-base font-bold text-gray-900 mb-3 leading-tight">
          Approve 15% Flash Discount — {productTitle}
        </h3>
        <div className="space-y-1 rounded-2xl bg-orange-50/60 border border-orange-100 p-1 overflow-hidden">
          {invRow && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-orange-100/40">
              <Package className="w-3 h-3 text-orange-500 shrink-0" />
              <span className="text-[10px] font-mono text-on-surface-variant w-32 shrink-0 uppercase tracking-wider">Inventory</span>
              <span className="text-sm font-mono font-bold text-orange-700">{invRow.to}</span>
            </div>
          )}
          {poasRow && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-rose-50/60">
              <TrendingDown className="w-3 h-3 text-rose-500 shrink-0" />
              <span className="text-[10px] font-mono text-on-surface-variant w-32 shrink-0 uppercase tracking-wider">7-Day POAS</span>
              <span className="text-sm font-mono font-bold text-rose-600">{poasRow.from}</span>
              <TrendingDown className="w-3 h-3 text-rose-400" />
              <span className="text-sm font-mono font-bold text-rose-400 line-through">≥1.5x target</span>
            </div>
          )}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-md">
            <Zap className="w-3 h-3 text-orange-500 shrink-0" />
            <span className="text-[10px] font-mono text-on-surface-variant w-32 shrink-0 uppercase tracking-wider">Discount</span>
            <span className="text-sm font-mono font-bold text-orange-600">0% → 15% (Flash Sale, 72h)</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-md">
            <span className="text-[10px] font-mono text-on-surface-variant w-32 shrink-0 uppercase tracking-wider">Promo Code</span>
            <code className="text-sm font-mono font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded border border-orange-200">
              {promoCode}
            </code>
          </div>
        </div>
      </div>

      {/* Projected Recovery — Impact zone */}
      <div className="px-4 py-3 border-b border-orange-50 bg-gradient-to-r from-emerald-50/40 to-transparent">
        <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">Zone 2 · Projected Profit Recovery</p>
        <div className="flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-emerald-500" />
          <div>
            <p className="text-lg font-bold text-emerald-700 leading-none">
              {recovery > 0
                ? <>+<MoneyTile usd={recovery} decimals={0} /></>
                : "Calculated on approve"}
            </p>
            <p className="text-xs text-emerald-600 mt-0.5">Estimated 7-day profit lift from stock clearance + POAS recovery</p>
          </div>
        </div>
      </div>

      {/* Reasoning */}
      <div className="border-b border-orange-50">
        <details className="group">
          <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer list-none text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors select-none">
            <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180 shrink-0" />
            Zone 3 · AI Trigger Analysis
          </summary>
          <div className="px-4 pb-3">
            <p className="text-xs text-on-surface-variant leading-relaxed">{card.reasoning}</p>
          </div>
        </details>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 bg-orange-50/30 flex-wrap">
        <div className="flex items-center gap-2">
          {currentUser && (
            <span className={cn("inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border", ROLE_COLORS[currentUser.role])}>
              {currentUser.name} · {ROLE_LABELS[currentUser.role]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isPending && (
            <>
              <button
                onClick={() => void handle("reject")}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono border border-outline-variant/15 text-on-surface-variant hover:border-rose-300 hover:text-rose-600 disabled:opacity-40 transition-all"
              >
                ✕ REJECT
              </button>
              <button
                onClick={() => void handle("approve")}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-mono font-bold bg-gradient-to-r from-orange-500 to-rose-500 text-white hover:shadow-[0_0_12px_rgba(249,115,22,0.4)] active:scale-[0.98] disabled:opacity-50 transition-all"
              >
                {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                {isActing ? "ACTIVATING…" : "APPROVE & ACTIVATE"}
              </button>
            </>
          )}
          {isTerminal && (
            <span className={cn("text-[10px] font-mono", statusCfg.cls.split(" ")[0])}>{statusCfg.label}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Preview summary builder ──────────────────────────────────────────────────
// Derives a short human-readable list of what the validate-only dry-run will
// check, based on the tool name and args stored in the snapshot.

function buildPreviewSummary(toolName: string, toolArgs: Record<string, unknown>): string[] {
  const lines: string[] = [];

  // Helper: format a raw value for display
  const fmt = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v === "number") return String(v);
    return String(v);
  };

  // Tool-specific breakdowns
  switch (toolName) {
    case "googleAds_updateCampaignBudget":
      lines.push("Op: Patch campaign budget (validate_only)");
      if (toolArgs.campaignBudgetId != null) lines.push(`Budget resource: ${fmt(toolArgs.campaignBudgetId)}`);
      if (toolArgs.newDailyBudgetUsd != null) {
        const usd = Number(toolArgs.newDailyBudgetUsd);
        lines.push(`New daily budget: ${isNaN(usd) ? fmt(toolArgs.newDailyBudgetUsd) : `$${usd.toFixed(2)}/day`}`);
      }
      break;
    case "googleAds_updateCampaignStatus":
      lines.push("Op: Patch campaign status (validate_only)");
      if (toolArgs.campaignId != null) lines.push(`Campaign: ${fmt(toolArgs.campaignId)}`);
      if (toolArgs.status != null) lines.push(`New status: ${fmt(toolArgs.status)}`);
      break;
    case "googleAds_updateCampaignBidding":
      lines.push("Op: Patch campaign bidding strategy (validate_only)");
      if (toolArgs.campaignId != null) lines.push(`Campaign: ${fmt(toolArgs.campaignId)}`);
      if (toolArgs.biddingStrategy != null) lines.push(`Strategy: ${fmt(toolArgs.biddingStrategy)}`);
      if (toolArgs.targetValue != null) lines.push(`Target value: ${fmt(toolArgs.targetValue)}`);
      break;
    case "meta_updateObjectStatus":
      lines.push("Op: Update Meta object status (validate_only)");
      if (toolArgs.objectId != null) lines.push(`Object ID: ${fmt(toolArgs.objectId)}`);
      if (toolArgs.objectType != null) lines.push(`Object type: ${fmt(toolArgs.objectType)}`);
      if (toolArgs.status != null) lines.push(`New status: ${fmt(toolArgs.status)}`);
      break;
    case "meta_updateAdSetBudget":
      lines.push("Op: Update Meta ad set budget (validate_only)");
      if (toolArgs.adSetId != null) lines.push(`Ad set ID: ${fmt(toolArgs.adSetId)}`);
      if (toolArgs.dailyBudget != null) {
        const usd = Number(toolArgs.dailyBudget);
        lines.push(`Daily budget: ${isNaN(usd) ? fmt(toolArgs.dailyBudget) : `$${usd.toFixed(2)}/day`}`);
      }
      if (toolArgs.lifetimeBudget != null) {
        const usd = Number(toolArgs.lifetimeBudget);
        lines.push(`Lifetime budget: ${isNaN(usd) ? fmt(toolArgs.lifetimeBudget) : `$${usd.toFixed(2)}`}`);
      }
      break;
    case "shopify_updateVariantPrice":
      lines.push("Op: Update Shopify variant price (validate_only)");
      if (toolArgs.variantId != null) lines.push(`Variant ID: ${fmt(toolArgs.variantId)}`);
      if (toolArgs.productId != null) lines.push(`Product ID: ${fmt(toolArgs.productId)}`);
      if (toolArgs.price != null) {
        const price = Number(toolArgs.price);
        lines.push(`New price: ${isNaN(price) ? fmt(toolArgs.price) : `$${price.toFixed(2)}`}`);
      }
      if (toolArgs.compareAtPrice != null) {
        const cap = Number(toolArgs.compareAtPrice);
        lines.push(`Compare-at price: ${isNaN(cap) ? fmt(toolArgs.compareAtPrice) : `$${cap.toFixed(2)}`}`);
      }
      break;
    case "shopify_updateProductStatus":
      lines.push("Op: Update Shopify product status (validate_only)");
      if (toolArgs.productId != null) lines.push(`Product ID: ${fmt(toolArgs.productId)}`);
      if (toolArgs.status != null) lines.push(`New status: ${fmt(toolArgs.status)}`);
      break;
    default: {
      lines.push(`Op: ${toolName} (validate_only)`);
      // Show scalar args as key: value lines (skip objects/arrays)
      for (const [k, v] of Object.entries(toolArgs)) {
        if (v == null || typeof v === "object") continue;
        lines.push(`${k}: ${fmt(v)}`);
        if (lines.length >= 6) break;
      }
    }
  }

  if (lines.length === 0) lines.push("No operation details available");
  return lines;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ApprovalCard({ card, onApprove, onApproveRequest, onReject, onRevert, onProposeFix, onPreview }: ApprovalCardProps) {
  // ── Promo Intelligence Engine cards get a specialized layout ──────────────
  if (card.toolName === "promo_engine_discount") {
    return (
      <PromoApprovalCard
        card={card}
        onApprove={onApprove}
        onReject={onReject}
        onApproveRequest={onApproveRequest}
      />
    );
  }

  const [ts] = useState(utcTime);
  const [isActing, setIsActing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposeComment, setProposeComment] = useState("");
  const [proposed, setProposed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ success: boolean; message: string } | null>(null);
  const { currentUser } = useUserRole();

  const handlePreview = async () => {
    if (!onPreview) return;
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const result = await onPreview(card.snapshotId);
      setPreviewResult(result);
    } catch (err) {
      setPreviewResult({ success: false, message: err instanceof Error ? err.message : "Preview failed" });
    } finally {
      setPreviewing(false);
    }
  };

  const impactLevel = computeImpactLevel(card);
  const requiredRole = REQUIRED_ROLE_FOR_IMPACT[impactLevel];
  const userCanApprove = currentUser ? canApproveImpact(currentUser.role, impactLevel) : true;

  const handleApprove = async () => {
    if (!userCanApprove) return;
    if (onApproveRequest) { onApproveRequest(card.snapshotId); return; }
    setIsActing(true); try { await onApprove(card.snapshotId); } finally { setIsActing(false); }
  };
  const handleReject  = async () => { setIsActing(true); try { await onReject(card.snapshotId);  } finally { setIsActing(false); } };
  const handleRevert  = async () => { setIsActing(true); try { await onRevert(card.snapshotId);  } finally { setIsActing(false); } };

  const statusCfg  = STATUS_CONFIG[card.status];
  const isTerminal = ["executed", "rejected", "reverted", "revert_failed", "failed"].includes(card.status);
  const canRevert  = card.status === "executed";
  const glow       = PLATFORM_GLOW[card.platform] ?? "border-outline-variant/15";
  const impact     = deriveImpactSentence(card);

  return (
    <div
      className={cn("mx-4 my-3 rounded-2xl border border-outline-variant/15 overflow-hidden bg-white", glow)}
      style={{ fontFeatureSettings: '"tnum" 1' }}
      id={`approval-card-${card.snapshotId}`}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3 border-b border-outline-variant/15/80">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
            Execution Proposal
          </span>
          <span className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono",
            statusCfg.cls,
          )}>
            {statusCfg.icon}
            {statusCfg.label}
          </span>
          <span className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono",
            IMPACT_COLORS[impactLevel],
          )}>
            <ShieldAlert className="w-2.5 h-2.5" />
            {impactLevel} IMPACT
          </span>
          <span className="ml-auto text-[9px] font-mono text-on-surface-variant">
            #{card.snapshotId} · {ts}
          </span>
        </div>
      </div>

      {/* ── ZONE 1: WHAT — Data Diff ── */}
      {card.displayDiff.length > 0 && (
        <div className="px-4 pt-4 pb-3 border-b border-outline-variant/15/60">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">
              Zone 1 · What Changes
            </span>
            <span className="flex items-center gap-1 text-[9px] font-mono text-on-surface-variant">
              {PLATFORM_ICONS[card.platform]}
              {card.platformLabel}
            </span>
          </div>

          {/* Tool name as large header */}
          <h3 className="text-base font-bold text-on-surface mb-3 leading-tight">
            {card.toolDisplayName}
          </h3>

          {/* Color-coded diff rows */}
          <div className="space-y-1 rounded-2xl bg-surface/60 border border-outline-variant/15/80 p-1 overflow-hidden">
            {card.displayDiff.map((row, i) => (
              <DiffLine key={i} row={row} />
            ))}
          </div>
        </div>
      )}

      {/* ── ZONE 2: IMPACT — Business summary ── */}
      <div className="px-4 py-3 border-b border-outline-variant/15/60 bg-white/30">
        <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5">
          Zone 2 · Expected Impact
        </p>
        <p className="text-sm font-semibold text-on-surface leading-snug">
          {impact}
        </p>
      </div>

      {/* ── ZONE 3: WHY — Collapsible reasoning ── */}
      {card.reasoning && (
        <div className="border-b border-outline-variant/15/60">
          <details className="group">
            <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer list-none text-[10px] font-mono text-on-surface-variant hover:text-on-surface-variant transition-colors select-none">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180 shrink-0" />
              Zone 3 · View AI Reasoning
            </summary>
            <div className="px-4 pb-3">
              <p className="text-xs text-on-surface-variant leading-relaxed whitespace-pre-wrap">
                {card.reasoning}
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ── Preview (validate-only) Result ── */}
      {previewResult && card.status === "pending" && (
        <div className={cn(
          "mx-4 my-3 rounded-md px-3 py-2 text-[11px] font-mono border flex items-start gap-2",
          previewResult.success
            ? "bg-emerald-500/5 text-emerald-500 border-emerald-500/20"
            : "bg-error-container/5 text-rose-500 border-rose-500/20",
        )}
        data-testid={`preview-result-${card.snapshotId}`}
        >
          {previewResult.success
            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="font-bold uppercase tracking-wider text-[9px] mb-0.5">
              {previewResult.success ? "Preview · Validation Passed" : "Preview · Validation Errors"}
            </div>
            <div className="whitespace-pre-wrap break-words leading-snug">{previewResult.message}</div>
            <div className="text-[9px] text-on-surface-variant mt-1 italic">No changes were made — action is still pending.</div>
          </div>
        </div>
      )}

      {/* ── Execution Result ── */}
      {card.executionMessage && isTerminal && (
        <div className={cn(
          "mx-4 my-3 rounded-md px-3 py-2 text-[11px] font-mono border",
          card.status === "executed" || card.status === "reverted"
            ? "bg-emerald-500/5  text-emerald-400  border-emerald-500/20"
            : "bg-error-container/5   text-rose-400    border-rose-500/20",
        )}>
          {card.executionMessage}
        </div>
      )}

      {/* ── Action Footer ── */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 bg-surface/40 flex-wrap">
        {/* Left: role context */}
        <div className="flex items-center gap-2">
          {currentUser && (
            <span className={cn(
              "inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border",
              ROLE_COLORS[currentUser.role],
            )}>
              {currentUser.name} · {ROLE_LABELS[currentUser.role]}
            </span>
          )}
          {card.status === "pending" && !userCanApprove && currentUser && (
            <span className="flex items-center gap-1 text-[9px] font-mono text-rose-400">
              <Lock className="w-2.5 h-2.5" />
              Requires {ROLE_LABELS[requiredRole]} approval
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
        {card.status === "pending" && ["google_ads", "meta", "shopify"].includes(card.platform) && onPreview && (
          <div className="relative group/prev">
            <button
              onClick={handlePreview}
              disabled={isActing || previewing}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono",
                "border border-accent-blue/40 text-accent-blue",
                "hover:bg-accent-blue/10 hover:border-accent-blue/60",
                "disabled:opacity-40 transition-all duration-150",
              )}
              data-testid={`btn-preview-${card.snapshotId}`}
              aria-describedby={`preview-tooltip-${card.snapshotId}`}
            >
              {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              {previewing ? "PREVIEWING…" : "PREVIEW"}
            </button>

            {/* Tooltip — visible on hover or keyboard-focus within */}
            <div
              id={`preview-tooltip-${card.snapshotId}`}
              role="tooltip"
              className={cn(
                "absolute bottom-full right-0 mb-2 z-50 w-64",
                "rounded-lg border border-accent-blue/25 bg-[#0e1117] shadow-[0_4px_24px_rgba(0,0,0,0.5)]",
                "pointer-events-none select-none",
                "opacity-0 translate-y-1 group-hover/prev:opacity-100 group-hover/prev:translate-y-0",
                "group-focus-within/prev:opacity-100 group-focus-within/prev:translate-y-0",
                "transition-all duration-150",
              )}
            >
              {/* Arrow */}
              <div className="absolute -bottom-1.5 right-4 w-3 h-3 rotate-45 bg-[#0e1117] border-r border-b border-accent-blue/25" />

              <div className="px-3 py-2.5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-accent-blue mb-2 flex items-center gap-1.5">
                  <Eye className="w-2.5 h-2.5" />
                  What Preview will validate
                </p>
                <ul className="space-y-1">
                  {buildPreviewSummary(card.toolName, card.toolArgs).map((line, i) => (
                    <li key={i} className={cn(
                      "text-[10px] font-mono leading-snug",
                      i === 0
                        ? "text-on-surface font-semibold"
                        : "text-on-surface-variant",
                    )}>
                      {i > 0 && <span className="text-accent-blue/50 mr-1">·</span>}
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[9px] font-mono text-on-surface-variant/60 italic border-t border-outline-variant/15 pt-1.5">
                  No changes are made — action stays pending.
                </p>
              </div>
            </div>
          </div>
        )}
        {card.status === "pending" && userCanApprove && (
          <>
            <button
              onClick={handleReject}
              disabled={isActing}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono",
                "border border-outline-variant/15 text-on-surface-variant",
                "hover:border-outline hover:text-on-surface-variant",
                "disabled:opacity-40 transition-all duration-150",
              )}
              data-testid={`btn-reject-${card.snapshotId}`}
            >
              ✕ REJECT
            </button>
            <button
              onClick={handleApprove}
              disabled={isActing}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11px] font-mono font-bold",
                "bg-accent-blue text-black hover:bg-accent-blue/90 hover:shadow-[0_0_12px_rgba(34,211,238,0.5)]",
                "active:scale-[0.98] disabled:opacity-50 transition-all duration-150",
              )}
              data-testid={`btn-execute-${card.snapshotId}`}
            >
              {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : "✓"}
              {isActing ? "DEPLOYING…" : "APPROVE & DEPLOY"}
            </button>
          </>
        )}
        {card.status === "pending" && !userCanApprove && !proposed && (
          proposing ? (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={proposeComment}
                onChange={(e) => setProposeComment(e.target.value)}
                placeholder="Add a note (optional)…"
                className="flex-1 sm:w-52 text-xs border border-outline-variant/15 rounded-2xl px-3 py-1.5 text-on-surface-variant placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary-container"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && onProposeFix) {
                    setIsActing(true);
                    onProposeFix(card, proposeComment).then(() => { setProposed(true); setProposing(false); }).catch(() => { /* error handled by caller */ }).finally(() => setIsActing(false));
                  }
                }}
              />
              <button
                onClick={() => {
                  if (!onProposeFix) return;
                  setIsActing(true);
                  onProposeFix(card, proposeComment).then(() => { setProposed(true); setProposing(false); }).catch(() => { /* error handled by caller */ }).finally(() => setIsActing(false));
                }}
                disabled={isActing}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-2xl text-[11px] font-semibold bg-primary-container text-white hover:bg-primary-m3 active:scale-95 transition-all disabled:opacity-50"
              >
                {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="material-symbols-outlined text-[14px]">send</span>}
                Submit
              </button>
              <button
                onClick={() => { setProposing(false); setProposeComment(""); }}
                className="text-xs text-on-surface-variant hover:text-on-surface-variant"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setProposing(true)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-2xl text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[14px]">rate_review</span>
              Propose Fix
            </button>
          )
        )}
        {card.status === "pending" && !userCanApprove && proposed && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Proposed — awaiting review
          </span>
        )}
          {canRevert && (
            <button
              onClick={handleRevert}
              disabled={isActing}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono",
                "border border-purple-500/30 text-purple-400",
                "hover:bg-purple-500/10 hover:border-purple-500/50",
                "disabled:opacity-40 transition-all duration-150",
              )}
              data-testid={`btn-revert-${card.snapshotId}`}
            >
              {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : "⏪"}
              {isActing ? "REVERTING…" : "REVERT"}
            </button>
          )}
          {isTerminal && !canRevert && (
            <span className={cn("text-[10px] font-mono", statusCfg.cls.split(" ")[0])}>
              {statusCfg.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
