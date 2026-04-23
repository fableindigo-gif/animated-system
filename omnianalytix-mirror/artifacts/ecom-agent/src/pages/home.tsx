import React, { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGeminiConversations,
  useCreateGeminiConversation,
  useGetGeminiConversation,
  useListConnections,
  getListGeminiConversationsQueryKey,
  getGetGeminiConversationQueryKey,
} from "@workspace/api-client-react";
import { ChatMessage } from "@/components/chat/message";
import { ChatInput } from "@/components/chat/input";
import { ChatWelcome } from "@/components/chat/welcome";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommandPanel } from "@/components/enterprise/command-panel";
import { PerformanceGrid } from "@/components/dashboard/performance-grid";
import DashboardCanvas from "@/components/DashboardCanvas";
import { StrategistThread, type ThreadEvent } from "@/components/command-center/strategist-thread";
import { ApprovalCard, type ApprovalCardData, type ApprovalStatus } from "@/components/command-center/approval-card";
import { PMaxXRay, type PMaxXRayData } from "@/components/command-center/pmax-xray";
import { CreativeIntelligenceCard, type CreativeAutopsyData } from "@/components/command-center/creative-intelligence-card";
import { AdCopyStudio, type AdCopyMatrixData } from "@/components/command-center/ad-copy-studio";
import { ComplianceCard, type ComplianceAuditData } from "@/components/command-center/compliance-card";
import type { GeminiMessage } from "@workspace/api-client-react";
import { Loader2, Activity, Terminal, FileDown, Zap, Settings, LayoutGrid, MessageSquare, Search, History, Users, AlertCircle, BarChart3 } from "lucide-react";
import { ClarificationChips, parseClarificationJSON, type ClarificationState } from "@/components/chat/clarification-chips";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command-palette";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { cn } from "@/lib/utils";
import { PortfolioSwitcher } from "@/components/enterprise/portfolio-switcher";
import { GlobalStatusBar } from "@/components/enterprise/global-status-bar";
import { SetTargetsWaitForm } from "@/components/home/set-targets-wait-form";
import { FirstInsightHero } from "@/components/home/first-insight-hero";
import { useDashboardStore } from "@/store/dashboardStore";
import { useWorkspace } from "@/contexts/workspace-context";
import { useCurrency } from "@/contexts/currency-context";
import { SKUGrid } from "@/components/enterprise/sku-grid";
import { GlassBoxModal } from "@/components/enterprise/glass-box-modal";
import { OnboardingWizard, useOnboardingState } from "@/components/enterprise/onboarding-wizard";
import { UndoToast, type UndoAction } from "@/components/enterprise/undo-toast";
import { useToast } from "@/hooks/use-toast";
import { StripeUpgradeModal } from "@/components/enterprise/stripe-upgrade-modal";
import { useSubscription } from "@/contexts/subscription-context";
import { trackEvent } from "@/lib/telemetry";
import { useDateRange } from "@/contexts/date-range-context";
import { getPreAuthSelections, clearPreAuthSelections } from "@/components/enterprise/pre-auth-onboarding";
import { authFetch, authPost } from "@/lib/auth-fetch";
import { useUserRole } from "@/contexts/user-role-context";


const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Session Title Generator ───────────────────────────────────────────────────

function generateSessionTitle(content: string): string {
  const t = content.toLowerCase();
  if (t.includes("stockout") || t.includes("inventory velocity") || t.includes("days remaining")) return "[Audit] Inventory Velocity";
  if (t.includes("poas") && t.includes("roas")) return "[Audit] ROAS · POAS Analysis";
  if (t.includes("poas")) return "[Audit] POAS Engine";
  if (t.includes("pmax") || t.includes("performance max")) return "[Audit] PMax X-Ray";
  if (t.includes("gmc") || t.includes("merchant center") || t.includes("disapproval")) return "[Audit] GMC Feed Health";
  if (t.includes("ad copy") || t.includes("copy matrix") || t.includes("ad copy matrix")) return "[Creative] Ad Copy Factory";
  if (t.includes("creative autopsy") || t.includes("analyze creative") || t.includes("multimodal")) return "[Creative] Creative Autopsy";
  if (t.includes("meta ad") || t.includes("meta copy") || t.includes("facebook ad")) return "[Creative] Meta Ad Copy";
  if (t.includes("blog") || t.includes("sge") || t.includes("page 2") || t.includes("keyword cluster")) return "[Content] SEO Blog Loop";
  if (t.includes("compliance") || t.includes("policy violation") || t.includes("pre-flight")) return "[Audit] Compliance Check";
  if (t.includes("pdf report") || t.includes("weekly pdf") || t.includes("client whisperer")) return "[Export] Weekly PDF Report";
  if (t.includes("qbr") || t.includes("quarterly") || t.includes("pptx")) return "[Export] QBR Deck";
  if (t.includes("forensic audit") || t.includes("5-step audit")) return "[Audit] Full Forensic Audit";
  if (t.includes("roas") || t.includes("campaign performance")) return "[Audit] Campaign Performance";
  if (t.includes("budget") || t.includes("capped") || t.includes("constrained")) return "[Audit] Budget Constraints";
  if (t.includes("customer match") || t.includes("high-ltv") || t.includes("lifetime value")) return "[Audit] Customer LTV";
  if (t.includes("discount") || t.includes("liquidation")) return "[Deploy] Liquidation Campaign";
  if (t.includes("shopify") || t.includes("catalog") || t.includes("product")) return "[Audit] Shopify Catalog";
  if (t.includes("google ads") || t.includes("bid") || t.includes("ai bidding")) return "[Audit] Google Ads";
  if (t.includes("meta") || t.includes("facebook")) return "[Audit] Meta Performance";
  if (t.includes("youtube") || t.includes("video link")) return "[Audit] YouTube Links";
  if (t.includes("report") || t.includes("export") || t.includes("download")) return "[Export] Data Report";
  return "[Query] System Request";
}

// ─── Dollar-impact extractor ──────────────────────────────────────────────────
// Inspects an approval card's diff rows and toolArgs for any monetary delta we
// can show in the paywall headline. Returns the absolute dollar value of the
// largest budget/spend/cost/savings/recovery row, or null if none found.

function extractDollarImpact(card: ApprovalCardData | undefined): number | null {
  if (!card) return null;

  // 1. toolArgs may carry projected/recovery numbers directly.
  const argKeys = ["projectedRecovery", "projectedSavings", "projectedDailySavings", "dailySavings", "savings", "dollarImpact"];
  for (const k of argKeys) {
    const v = card.toolArgs?.[k];
    if (v != null) {
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
      if (!isNaN(n) && Math.abs(n) > 0) return Math.abs(n);
    }
  }

  // 2. Look at displayDiff for a budget/spend/cost/savings row with a delta.
  let largest = 0;
  for (const row of card.displayDiff ?? []) {
    if (!/budget|spend|cost|savings|revenue|recovery|profit/i.test(row.label)) continue;
    const from = parseFloat((row.from ?? "").replace(/[^0-9.-]/g, ""));
    const to   = parseFloat((row.to ?? "").replace(/[^0-9.-]/g, ""));
    if (!isNaN(from) && !isNaN(to)) {
      const delta = Math.abs(to - from);
      if (delta > largest) largest = delta;
    } else if (!isNaN(to)) {
      const v = Math.abs(to);
      if (v > largest) largest = v;
    }
  }
  return largest > 0 ? largest : null;
}

// ─── Rich Card Types ───────────────────────────────────────────────────────────

type RichCardType =
  | { id: string; type: "pmax_xray"; data: PMaxXRayData }
  | { id: string; type: "creative_autopsy"; data: CreativeAutopsyData }
  | { id: string; type: "ad_copy_matrix"; data: AdCopyMatrixData }
  | { id: string; type: "compliance_audit"; data: ComplianceAuditData }
  | { id: string; type: "poas_metrics"; data: Record<string, unknown> }
  | { id: string; type: "catalog_sweep"; data: Record<string, unknown> };

export default function Home() {
  const { activeWorkspace, justSwitched } = useWorkspace();
  const { currentUser } = useUserRole();
  const { toast } = useToast();
  // wouter exposes navigate as the second tuple element of useLocation()
  const [, navigate] = useLocation();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const abortCtrlRef = useRef<AbortController | null>(null);

  // Approval cards for this session: snapshotId → card data
  const [approvalCards, setApprovalCards] = useState<Map<number, ApprovalCardData>>(new Map());
  const [approvalOrder, setApprovalOrder] = useState<number[]>([]);

  // Subscribe to dashboard sync state so the wait-form re-renders as the
  // backend transitions from HISTORICAL_BACKFILL → SYNCING → OPERATIONAL.
  const dashboardSyncState = useDashboardStore((s) => s.syncState);
  const showSetTargetsForm =
    dashboardSyncState === "HISTORICAL_BACKFILL" || dashboardSyncState === "SYNCING";

  const [showWelcome, setShowWelcome] = useState(() => {
    const role = (localStorage.getItem("omni_user_role") ?? "").toLowerCase();
    const isAdminRole = role === "admin" || role === "agency_owner" || role === "super_admin";
    return isAdminRole && !localStorage.getItem("omni_welcome_v1");
  });
  const dismissWelcome = () => {
    localStorage.setItem("omni_welcome_v1", "1");
    setShowWelcome(false);
  };

  // Rich cards produced by tool executions (rendered inline)
  const [richCards, setRichCards] = useState<RichCardType[]>([]);
  const [richCardOrder, setRichCardOrder] = useState<string[]>([]);

  // Strategist thread events
  const [threadEvents, setThreadEvents] = useState<ThreadEvent[]>([]);

  // Mobile pane navigation
  const [mobilePane, setMobilePane] = useState<"radar" | "chat" | "reports">("chat");

  const personaMode = "analyst";

  // Injected input for entity lookup (product ID from inline catalog)
  const [injectedInput, setInjectedInput] = useState("");

  // Structured clarification chips — AI returned JSON options instead of answering
  const [pendingClarification, setPendingClarification] = useState<ClarificationState | null>(null);
  // Stream timeout: triggered when AI takes >30s with no completion event
  const [streamTimedOut, setStreamTimedOut] = useState(false);

  // Command Palette open state
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // Enterprise: Data density view toggle — "summary" | "grid" | "dashboard" | "overview"
  const [viewMode, setViewMode] = useState<"summary" | "grid" | "dashboard" | "overview">("dashboard");


  // Enterprise: Glass-box approval modal — holds snapshotId awaiting confirmation
  const [glassBoxPending, setGlassBoxPending] = useState<number | null>(null);

  // Undo toast — persistent toast after successful execution
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

  // Stripe upgrade modal — gated behind subscription tier. We carry the
  // dollar impact + action label of whatever the user was about to approve
  // so the modal can render value-anchored copy ("You're about to save
  // $312/day…") instead of generic "upgrade to Pro" boilerplate.
  const [stripeModalOpen, setStripeModalOpen] = useState(false);
  const [stripeContext, setStripeContext] = useState<{
    dollarImpact: number | null;
    actionLabel: string | null;
    impactCadence: "day" | "month";
  }>({ dollarImpact: null, actionLabel: null, impactCadence: "day" });
  const { isPro } = useSubscription();

  // Onboarding wizard
  const { complete: onboardingComplete, markComplete: markOnboardingComplete } = useOnboardingState();

  const { data: connections = [], isLoading: isLoadingConnections } = useListConnections();

  useEffect(() => {
    if (onboardingComplete || isLoadingConnections) return;
    const shopify = connections.some((c) => c.platform === "shopify" && c.isActive);
    const google  = connections.some(
      (c) => ["google_ads", "gsc", "youtube"].includes(c.platform) && c.isActive,
    );
    if (shopify && google) markOnboardingComplete();
  }, [connections, isLoadingConnections, onboardingComplete, markOnboardingComplete]);

  useEffect(() => {
    if (!activeWorkspace) return;
    const preAuth = getPreAuthSelections();
    if (!preAuth.goal) return;
    const alreadySet = activeWorkspace.primaryGoal && ["ecom", "leadgen", "hybrid"].includes(activeWorkspace.primaryGoal);
    if (alreadySet) { clearPreAuthSelections(); return; }
    const wsId = activeWorkspace.id;
    const applyOnboarding = (): Promise<void> =>
      authFetch(`${API_BASE}api/workspaces/${wsId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryGoal: preAuth.goal,
          enabledIntegrations: preAuth.platforms,
        }),
      })
        .then((r) => { if (r.ok) clearPreAuthSelections(); })
        .catch((err) => {
          console.error("[Home] Failed to apply pre-auth onboarding:", err);
          toast({
            title: "Couldn't save your onboarding choices",
            description: "Your platform selections weren't applied. Try again now or from Settings.",
            variant: "destructive",
            action: { label: "Try again", onClick: () => { void applyOnboarding(); } },
          });
        });
    void applyOnboarding();
  }, [activeWorkspace, toast]);

  // Global ⌘K / Ctrl+K listener for Command Palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Bridge: CommandPalette dispatches `omni:command-prompt` with a prompt
  // string in `detail`. We send it through the chat pipeline as if the user
  // typed it. Switch to summary view + chat pane so the response is visible.
  useEffect(() => {
    const onPalettePrompt = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== "string" || !detail.trim()) return;
      setViewMode("summary");
      setMobilePane("chat");
      setTimeout(() => handleSend(detail), 80);
    };
    window.addEventListener("omni:command-prompt", onPalettePrompt as EventListener);
    return () => window.removeEventListener("omni:command-prompt", onPalettePrompt as EventListener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const checkAuditFlag = () => {
      if (sessionStorage.getItem("omni_inject_audit") === "true") {
        sessionStorage.removeItem("omni_inject_audit");
        setViewMode("summary");
        setMobilePane("chat");
        const auditPrompt = "Run the master diagnostic sweep across all connected platforms right now. Execute run_master_diagnostic_sweep and present the full EXECUTIVE SYSTEM DIAGNOSTIC with critical, warnings, and healthy sections ranked by margin impact. Be terse and decisive.";
        setTimeout(() => handleSend(auditPrompt), 300);
      }
      const prefill = sessionStorage.getItem("omni_prefill_prompt");
      if (prefill) {
        sessionStorage.removeItem("omni_prefill_prompt");
        setViewMode("summary");
        setMobilePane("chat");
        setTimeout(() => handleSend(prefill), 300);
      }
    };
    checkAuditFlag();
    window.addEventListener("storage", checkAuditFlag);
    return () => window.removeEventListener("storage", checkAuditFlag);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const queryClient = useQueryClient();
  const { data: conversations = [] } = useListGeminiConversations();

  const { data: activeConversation, isLoading: isLoadingActive } = useGetGeminiConversation(
    activeId!,
    {
      query: {
        queryKey: getGetGeminiConversationQueryKey(activeId!),
        enabled: !!activeId,
      },
    },
  );

  const createMutation = useCreateGeminiConversation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSelectConv = (id: number | null) => {
    setActiveId(id);
    setApprovalCards(new Map());
    setApprovalOrder([]);
    setRichCards([]);
    setRichCardOrder([]);
    setThreadEvents([]);
    setStreamedContent("");
    setIsStreaming(false);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      const vp = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (vp) vp.scrollTop = vp.scrollHeight;
    }
  };

  useEffect(() => { scrollToBottom(); }, [activeConversation?.messages, streamedContent, approvalOrder.length, richCardOrder.length, isStreaming]);

  // ─── Approval Handlers ──────────────────────────────────────────────────────

  // Fire-and-forget access request: sends an in-app request to workspace
  // admins describing the action the current user was blocked on. Admins
  // grant or dismiss it from settings → Access requests. We always show a
  // confirmation toast so the user knows the request landed.
  const requestAccess = useCallback(async (actionLabel: string, toolName: string | null) => {
    try {
      const res = await authPost(`${API_BASE}api/team/access-requests`, {
        actionLabel,
        actionContext: toolName ?? "",
        workspaceId: activeWorkspace?.id ?? null,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      trackEvent("access_request_sent", {
        trigger: "rbac_block",
        tool_name: toolName ?? undefined,
        action_label: actionLabel,
      });
      toast({
        title: "Request sent",
        description: `Your workspace admin has been notified about “${actionLabel}”.`,
      });
    } catch (err) {
      console.error("[Home] access-request failed", err);
      toast({
        title: "Couldn't send request",
        description: "Something went wrong sending your access request. Try again in a moment.",
        variant: "destructive",
        action: {
          label: "Try again",
          onClick: () => { void requestAccess(actionLabel, toolName); },
        },
      });
    }
  }, [activeWorkspace, toast]);

  const updateCard = useCallback((snapshotId: number, patch: Partial<ApprovalCardData>) => {
    setApprovalCards((prev) => {
      const next = new Map(prev);
      const card = next.get(snapshotId);
      if (card) next.set(snapshotId, { ...card, ...patch });
      return next;
    });
  }, []);

  const handleApprove = useCallback(async (snapshotId: number) => {
    const card = approvalCards.get(snapshotId);
    if (!isPro) {
      const dollarImpact = extractDollarImpact(card);
      const actionLabel = card?.toolDisplayName ?? null;
      setStripeContext({ dollarImpact, actionLabel, impactCadence: "day" });
      trackEvent("paywall_viewed", {
        trigger: "approval_action",
        dollar_impact: dollarImpact ?? undefined,
        tool_name: card?.toolName ?? undefined,
      });
      setStripeModalOpen(true);
      throw new Error("Upgrade required");
    }
    updateCard(snapshotId, { status: "executing" as ApprovalStatus });
    try {
      const resp = await authFetch(`${API_BASE}api/actions/${snapshotId}/approve`, { method: "POST" });
      if (resp.status === 403) {
        const body = await resp.json().catch(() => ({})) as { code?: string; message?: string };
        updateCard(snapshotId, { status: "pending" as ApprovalStatus });
        if (body.code === "RBAC_INSUFFICIENT_ROLE" || body.code === "RBAC_NO_IDENTITY") {
          const actionLabel = card?.toolDisplayName ?? "this action";
          toast({
            title: "Permission needed",
            description: body.message || `You don't have permission to approve ${actionLabel}. Send a one-click request to your workspace admin.`,
            variant: "destructive",
            action: {
              label: "Request access",
              onClick: () => { void requestAccess(actionLabel, card?.toolName ?? null); },
            },
          });
          throw new Error(body.message || "Insufficient permissions");
        }
        const dollarImpact = extractDollarImpact(card);
        setStripeContext({ dollarImpact, actionLabel: card?.toolDisplayName ?? null, impactCadence: "day" });
        trackEvent("paywall_viewed", {
          trigger: "rbac_fallback",
          dollar_impact: dollarImpact ?? undefined,
          tool_name: card?.toolName ?? undefined,
        });
        setStripeModalOpen(true);
        throw new Error("Upgrade required");
      }
      const result = await resp.json() as { success: boolean; message: string; snapshotId?: number };
      const newStatus: ApprovalStatus = result.success ? "executed" : "failed";
      updateCard(snapshotId, { status: newStatus, executionMessage: result.message });
      setThreadEvents((prev) => [...prev, {
        type: "approval_executed",
        toolDisplayName: card?.toolDisplayName ?? "Action",
        success: result.success,
        ts: Date.now(),
      }]);
      if (result.success) {
        setUndoAction({
          snapshotId,
          toolDisplayName: card?.toolDisplayName ?? "Action",
          message: result.message,
        });
      } else {
        throw new Error(result.message || "Execution failed");
      }
    } catch (err) {
      if (err instanceof Error && (err.message === "Upgrade required" || err.message === "Insufficient permissions")) {
        throw err;
      }
      updateCard(snapshotId, { status: "failed" as ApprovalStatus, executionMessage: err instanceof Error ? err.message : "Network error during execution." });
      throw err;
    }
  }, [approvalCards, updateCard, isPro]);

  const handlePreview = useCallback(async (snapshotId: number) => {
    const resp = await authFetch(`${API_BASE}api/actions/${snapshotId}/preview`, { method: "POST" });
    const body = await resp.json().catch(() => ({})) as { success?: boolean; message?: string; error?: string };
    if (!resp.ok) {
      return { success: false, message: body.error || body.message || `Preview failed (${resp.status})` };
    }
    return { success: !!body.success, message: body.message || (body.success ? "Validation passed — no errors." : "Validation reported issues.") };
  }, []);

  const handleReject = useCallback(async (snapshotId: number) => {
    const card = approvalCards.get(snapshotId);
    try {
      await authFetch(`${API_BASE}api/actions/${snapshotId}/reject`, { method: "POST" });
      updateCard(snapshotId, { status: "rejected" as ApprovalStatus });
      setThreadEvents((prev) => [...prev, {
        type: "approval_rejected",
        toolDisplayName: card?.toolDisplayName ?? "Action",
        ts: Date.now(),
      }]);
    } catch {
      updateCard(snapshotId, { status: "rejected" as ApprovalStatus });
    }
  }, [approvalCards, updateCard]);

  const handleRevert = useCallback(async (snapshotId: number) => {
    const card = approvalCards.get(snapshotId);
    updateCard(snapshotId, { status: "executing" as ApprovalStatus });
    try {
      const resp = await authFetch(`${API_BASE}api/actions/${snapshotId}/revert`, { method: "POST" });
      const result = await resp.json() as { success: boolean; message: string };
      const newStatus: ApprovalStatus = result.success ? "reverted" : "revert_failed";
      updateCard(snapshotId, { status: newStatus, executionMessage: result.message });
      setThreadEvents((prev) => [...prev, {
        type: "approval_executed",
        toolDisplayName: `Revert: ${card?.toolDisplayName ?? "Action"}`,
        success: result.success,
        ts: Date.now(),
      }]);
    } catch {
      updateCard(snapshotId, { status: "revert_failed" as ApprovalStatus, executionMessage: "Network error during revert." });
    }
  }, [approvalCards, updateCard]);

  const handleProposeFix = useCallback(async (proposalCard: ApprovalCardData, comments: string) => {
    const res = await authPost(`${API_BASE}api/tasks`, {
      platform: proposalCard.platform,
      platformLabel: proposalCard.platformLabel,
      toolName: proposalCard.toolName,
      toolDisplayName: proposalCard.toolDisplayName,
      toolArgs: proposalCard.toolArgs,
      displayDiff: proposalCard.displayDiff,
      reasoning: proposalCard.reasoning,
      snapshotId: proposalCard.snapshotId,
      comments,
    });
    if (!res.ok) {
      throw new Error("Failed to submit proposal");
    }
  }, []);

  // ─── Product Select (from inline catalog lookup) ────────────────────────────

  const handleProductSelect = useCallback((productId: string, productTitle: string) => {
    setViewMode("summary");
    setInjectedInput(`Product ID: ${productId} (${productTitle}). `);
    setMobilePane("chat");
  }, []);

  // ─── Report Downloads ───────────────────────────────────────────────────────

  const handleDownloadWeeklyPDF = () => {
    window.open(`${API_BASE}api/reports/weekly-pdf`, "_blank");
  };

  const handleDownloadQBR = () => {
    const clientName = prompt("Client name for QBR report?", "Client") ?? "Client";
    const quarter = prompt("Quarter?", "Q2 2025") ?? "Q2 2025";
    authFetch(`${API_BASE}api/reports/qbr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName, quarter }),
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `qbr-${clientName.replace(/\s+/g, "-").toLowerCase()}.pptx`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {/* QBR download failed */});
  };

  // ─── Send Message ──────────────────────────────────────────────────────────

  const handleSend = async (content: string) => {
    if (isStreaming) return;
    setViewMode("summary");
    setIsStreaming(true);
    setStreamedContent("");
    setPendingClarification(null);
    setStreamTimedOut(false);

    let targetConvId = activeId;

    if (!targetConvId) {
      const titlePreview = generateSessionTitle(content);
      const conv = await createMutation.mutateAsync({ data: { title: titlePreview } } as Parameters<typeof createMutation.mutateAsync>[0]);
      targetConvId = conv.id;
      setActiveId(targetConvId);
      queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
    }

    // ── 60s stale-stream timeout ───────────────────────────────────────────────
    // Aborts if no SSE event arrives for 60 consecutive seconds. Long warehouse
    // queries and multi-tool chains can legitimately take 30+ seconds, so we
    // give them generous headroom before showing the fallback banner.
    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;
    let staleTimerId = window.setTimeout(() => abortCtrl.abort(), 60_000);
    const resetStaleTimer = () => {
      clearTimeout(staleTimerId);
      staleTimerId = window.setTimeout(() => abortCtrl.abort(), 60_000);
    };

    // Accumulate full text for post-stream clarification parsing
    let fullStreamText = "";

    try {
      const resp = await authFetch(`${API_BASE}api/gemini/conversations/${targetConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          personaMode,
          primaryGoal:   activeWorkspace?.primaryGoal  ?? null,
          workspaceId:   activeWorkspace?.id           ?? null,
          workspaceName: activeWorkspace?.clientName   ?? null,
        }),
        signal: abortCtrl.signal,
      });

      if (!resp.body) { clearTimeout(staleTimerId); setIsStreaming(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        resetStaleTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));

            if (json.content) {
              fullStreamText += json.content as string;
              setStreamedContent((p) => p + json.content);
            }

            if (json.toolExecution) {
              const tools = json.tools as string[];
              const isApproval = !!json.requiresApproval;
              if (!isApproval) {
                setThreadEvents((prev) => [...prev, { type: "tool_start", tools, ts: Date.now() }]);
              }
            }

            if (json.toolResult) {
              setThreadEvents((prev) => [...prev, {
                type: "tool_result",
                name: json.toolResult.name as string,
                success: json.toolResult.success as boolean,
                message: json.toolResult.message as string,
                ts: Date.now(),
              }]);
            }

            // ── Rich Card SSE events ──────────────────────────────────────
            if (json.richCard) {
              const card = json.richCard as { type: string; data: Record<string, unknown> };
              const id = `${card.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const typedCard = { id, ...card } as RichCardType;
              setRichCards((prev) => {
                const next = [...prev];
                const existingIdx = next.findIndex((c) => c.type === card.type);
                if (existingIdx >= 0) { next[existingIdx] = typedCard; } else { next.push(typedCard); }
                return next;
              });
              setRichCardOrder((prev) => {
                if (prev.includes(id)) return prev;
                return [...prev, id];
              });
            }

            if (json.approvalCard) {
              const card = json.approvalCard as ApprovalCardData;
              setApprovalCards((prev) => new Map(prev).set(card.snapshotId, card));
              setApprovalOrder((prev) => [...prev, card.snapshotId]);
              setThreadEvents((prev) => [...prev, {
                type: "approval_queued",
                toolDisplayName: card.toolDisplayName,
                platform: card.platform,
                ts: Date.now(),
              }]);
            }

            // ── OmniAction SSE events ─────────────────────────────────────
            // The AI may emit structured [OMNI_ACTION] directives that the
            // backend extracts and forwards as {omniAction: {...}} SSE events.
            // The frontend executes the action transparently — no JSON is
            // shown to the user.
            if (json.omniAction) {
              const act = json.omniAction as { action: string; target?: string; alertId?: number; prompt?: string; skuId?: string };
              switch (act.action) {
                case "navigate":
                  if (typeof act.target === "string" && act.target.startsWith("/")) {
                    navigate(act.target);
                  }
                  break;
                case "open_copilot":
                  window.dispatchEvent(new CustomEvent("omni:open-copilot", {
                    detail: { prompt: act.prompt ?? "" },
                  }));
                  break;
                case "open_triage":
                  navigate("/");
                  window.dispatchEvent(new CustomEvent("omni:focus-triage", {
                    detail: { alertId: act.alertId },
                  }));
                  break;
                case "open_playbook":
                  navigate("/resolution-base");
                  break;
                case "highlight_sku":
                  navigate("/");
                  window.dispatchEvent(new CustomEvent("omni:highlight-sku", {
                    detail: { skuId: act.target ?? act.skuId },
                  }));
                  break;
                default:
                  break;
              }
            }

            if (json.done) {
              clearTimeout(staleTimerId);
              // ── Parse structured clarification JSON ──────────────────────
              // If the AI returned a requires_clarification JSON, surface chips
              const clarResult = parseClarificationJSON(fullStreamText);
              if (clarResult.isClarification) {
                setPendingClarification(clarResult.state);
              }
              queryClient.invalidateQueries({ queryKey: getGetGeminiConversationQueryKey(targetConvId) });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: unknown) {
      clearTimeout(staleTimerId);
      const error = err as Error;
      if (error?.name === "AbortError" || abortCtrl.signal.aborted) {
        setStreamTimedOut(true);
      } else {
        toast({ title: "Connection lost", description: "The AI response was interrupted. Please try again.", variant: "destructive" });
      }
    } finally {
      clearTimeout(staleTimerId);
      abortCtrlRef.current = null;
      setIsStreaming(false);
      setStreamedContent("");
      queryClient.invalidateQueries({ queryKey: getGetGeminiConversationQueryKey(targetConvId) });
    }
  };

  // ─── Chip Selection Handler ────────────────────────────────────────────────
  // Called when user clicks a clarification chip. Clears the chip UI and
  // re-submits with the selected value so the AI can proceed immediately.
  const handleChipSelect = useCallback((value: string, label: string) => {
    setPendingClarification(null);
    setStreamTimedOut(false);
    handleSend(`[Selected: ${label}] ${value}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStopStreaming = useCallback(() => {
    abortCtrlRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      abortCtrlRef.current?.abort();
    };
  }, []);

  const handleTriggerSync = useCallback(() => {
    handleSend("sync the warehouse");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = useCallback((path: string) => {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    window.location.href = `${base}${path}`;
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  const haptic = () => {
    if (typeof window !== "undefined" && window.navigator?.vibrate) {
      window.navigator.vibrate(50);
    }
  };

  return (
    <>
    <div className="h-full w-full flex flex-col bg-surface text-on-surface overflow-hidden">

      {/* ── Global System Status Bar ── */}
      <GlobalStatusBar />

      {/* ── First-sync productivity banner: lets the user configure targets
          (COGS %, target ROAS) while the warehouse hydrates so KPIs are
          meaningful the moment the dashboard appears. Self-hides when both
          targets are configured, and is naturally invisible after the sync
          completes because it only renders during HISTORICAL_BACKFILL /
          SYNCING states. */}
      {showSetTargetsForm && <SetTargetsWaitForm />}

      {/* ── First-insight celebration hero: surfaces the largest open margin
          leak as the user-visible payoff of "first value". Dismissible per
          workspace via localStorage. */}
      <FirstInsightHero onOpenDashboard={() => { setViewMode("dashboard"); setMobilePane("radar"); }} />

      {/* ── Workspace Switch Toast ── */}
      {justSwitched && activeWorkspace && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent-blue/5 border-b border-accent-blue/20 text-xs font-medium text-accent-blue animate-in slide-in-from-top duration-300 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
          Switched to workspace: <span className="font-bold text-on-surface">{activeWorkspace.clientName}</span>
          <span className="text-on-surface-variant ml-1">· {activeWorkspace.slug}</span>
        </div>
      )}

      {/* ── Welcome banner — shown once to new agency admins ── */}
      {showWelcome && (
        <div className="px-4 py-3 border-b border-primary-container/15 bg-primary-container/5 shrink-0 animate-in slide-in-from-top duration-300">
          <div className="max-w-4xl mx-auto flex items-start gap-4">
            <div className="w-8 h-8 rounded-xl bg-primary-container/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[17px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>waving_hand</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface">Welcome to OmniAnalytix — here's how to get started</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
                {[
                  { n: 1, label: "Add a client workspace", hint: "Use the workspace switcher in the sidebar" },
                  { n: 2, label: "Connect their data sources", hint: "Go to Connections in Administration" },
                  { n: 3, label: "Invite your team", hint: "Go to Team & Access in Administration" },
                ].map(({ n, label, hint }) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary-container text-white text-[9px] font-black flex items-center justify-center shrink-0">{n}</span>
                    <div>
                      <span className="text-xs font-semibold text-on-surface">{label}</span>
                      <span className="text-[10px] text-on-surface-variant ml-1.5">{hint}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={dismissWelcome}
              className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-low transition-colors shrink-0"
              aria-label="Dismiss welcome"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Three-pane layout ── */}
      <div className="flex flex-1 overflow-hidden">

      {/* LEFT — Command Panel (KPI tiles + Account Health + log history) */}
      <div className={cn(
        "shrink-0 h-full transition-all duration-200",
        "lg:flex lg:w-[340px]",
        mobilePane === "radar" ? "flex w-full" : "hidden",
      )}>
        <ErrorBoundary fallbackLabel="Unable to load command panel">
          <CommandPanel
            connections={connections}
            conversations={conversations}
            activeConvId={activeId}
            onSelectConv={(id) => { setViewMode("summary"); handleSelectConv(id); setMobilePane("chat"); }}
            onNewConv={() => { setViewMode("summary"); handleSelectConv(null); setMobilePane("chat"); }}
            onTriageAction={(prompt) => { setViewMode("summary"); setInjectedInput(prompt); setMobilePane("chat"); }}
          />
        </ErrorBoundary>
      </div>

      {/* CENTER — Action Board */}
      <div className={cn(
        "flex-1 flex flex-col min-w-0",
        mobilePane !== "chat" ? "hidden lg:flex" : "flex",
      )}>
        {/* Center header */}
        <div className="border-b border-[rgba(200,197,203,0.15)] px-4 flex items-center gap-3 bg-white shrink-0 min-h-[48px]">
          <BarChart3 className="w-3.5 h-3.5 text-accent-blue shrink-0" />
          <div className="flex flex-col">
            <p className="text-[9px] font-semibold text-on-secondary-container uppercase tracking-widest leading-none">Dashboard</p>
            <p className="text-[12px] font-bold text-on-surface leading-tight">Performance & AI Logs</p>
          </div>

          {activeConversation?.title && (
            <div className="hidden sm:flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className="text-outline-variant text-xs">/</span>
              <span className="text-[11px] text-on-surface-variant truncate max-w-[200px]">{activeConversation.title}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {isStreaming && (
              <div className="flex items-center gap-1.5 text-xs text-accent-blue/70">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="hidden sm:inline text-[10px] font-semibold tracking-wider">Processing…</span>
              </div>
            )}

            <div className="flex items-center border border-outline-variant/30 rounded-2xl overflow-hidden">
              {([
                { mode: "dashboard", icon: <BarChart3 className="w-3 h-3" />,   label: "Dashboard"  },
                { mode: "summary",   icon: <Terminal className="w-3 h-3" />,    label: "Logs"       },
                { mode: "grid",      icon: <Search className="w-3 h-3" />,      label: "SKU Grid"   },
              ] as const).map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold border-r border-outline-variant/30 last:border-r-0 transition-all",
                    viewMode === mode
                      ? "bg-accent-blue/10 text-accent-blue"
                      : "text-on-secondary-container hover:text-on-surface hover:bg-surface",
                  )}
                >
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <CommandPaletteTrigger onClick={() => setIsPaletteOpen(true)} />
          </div>
        </div>

        {/* Overview === Dashboard (unified canvas) */}
        {viewMode === "overview" && (
          <ErrorBoundary fallbackLabel="Unable to load overview">
            <DashboardCanvas onChat={(msg) => { setViewMode("summary"); void handleSend(msg); }} />
          </ErrorBoundary>
        )}

        {/* Grid View — full-width SKU data table */}
        {viewMode === "grid" && (
          <div className="flex-1 overflow-hidden">
            <SKUGrid />
          </div>
        )}

        {/* Dashboard View — unified state-machine canvas with WidgetRegistry */}
        {viewMode === "dashboard" && (
          <ErrorBoundary fallbackLabel="Unable to load dashboard">
            <DashboardCanvas onChat={(msg) => { setViewMode("summary"); void handleSend(msg); }} />
          </ErrorBoundary>
        )}

        {/* Summary View — existing conversational UI */}
        {viewMode === "summary" && !!activeId && (
          <>
            <ScrollArea ref={scrollRef} className="flex-1">
              <div className="flex flex-col pb-4">
                {isLoadingActive ? (
                  <div className="flex items-center justify-center pt-20 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin opacity-50" />
                  </div>
                ) : (
                  <>
                    {activeConversation?.messages?.map((msg, i) => {
                      // After each assistant message, render any rich cards that arrived with it
                      return (
                        <React.Fragment key={msg.id}>
                          <ChatMessage
                            role={msg.role as "user" | "assistant"}
                            content={msg.content}
                            onSuggestionClick={handleSend}
                            onProductSelect={handleProductSelect}
                            onTriggerSync={handleTriggerSync}
                            onNavigate={handleNavigate}
                          />
                        </React.Fragment>
                      );
                    })}

                    {/* Rich cards rendered inline after messages */}
                    {richCardOrder.map((cardId) => {
                      const card = richCards.find((c) => c.id === cardId);
                      if (!card) return null;
                      return (
                        <React.Fragment key={cardId}>
                          {card.type === "pmax_xray" && (
                            <PMaxXRay data={card.data as PMaxXRayData} />
                          )}
                          {card.type === "creative_autopsy" && (
                            <CreativeIntelligenceCard data={card.data as CreativeAutopsyData} />
                          )}
                          {card.type === "ad_copy_matrix" && (
                            <AdCopyStudio data={card.data as AdCopyMatrixData} />
                          )}
                          {card.type === "compliance_audit" && (
                            <ComplianceCard data={card.data as ComplianceAuditData} />
                          )}
                          {card.type === "poas_metrics" && (
                            <POASMetricsCard data={card.data as Record<string, unknown>} />
                          )}
                          {card.type === "catalog_sweep" && (
                            <CatalogSweepCard data={card.data as Record<string, unknown>} />
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Approval cards rendered inline */}
                    {approvalOrder.map((snapshotId) => {
                      const card = approvalCards.get(snapshotId);
                      if (!card) return null;
                      return (
                        <ApprovalCard
                          key={snapshotId}
                          card={card}
                          onApprove={handleApprove}
                          onApproveRequest={(id) => setGlassBoxPending(id)}
                          onReject={handleReject}
                          onRevert={handleRevert}
                          onProposeFix={handleProposeFix}
                          onPreview={handlePreview}
                        />
                      );
                    })}

                    {/* Streaming assistant response — live region so screen readers
                        hear incremental tokens as they arrive. role="log" + polite
                        aria-live + aria-atomic="false" lets assistive tech read only
                        appended text without interrupting the user. */}
                    <div
                      role="log"
                      aria-live="polite"
                      aria-atomic="false"
                      aria-relevant="additions text"
                      aria-label="Assistant response"
                    >
                      {isStreaming && streamedContent && (
                        <div className="relative">
                          <ChatMessage role="assistant" content={streamedContent} onTriggerSync={handleTriggerSync} onNavigate={handleNavigate} />
                          <span className="absolute bottom-6 right-8 w-2 h-2 bg-primary rounded-full animate-pulse" aria-hidden="true" />
                        </div>
                      )}
                      {isStreaming && !streamedContent && <TerminalLoader />}
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
            <div className="shrink-0">
              {/* ── Scenario D: AI tool timeout fallback banner ─────────────── */}
              {streamTimedOut && !isStreaming && (
                <div className="mx-4 mb-2 flex items-start gap-2.5 px-3 py-2.5 rounded-2xl border border-amber-400/20 bg-amber-400/5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-400 font-mono leading-relaxed">
                    The request is taking longer than expected. This may be a complex multi-platform query — try simplifying it or breaking it into smaller questions.
                  </p>
                </div>
              )}
              {/* ── Part 3: Zero-friction clarification chips ───────────────── */}
              {!isStreaming && pendingClarification && (
                <ClarificationChips
                  state={pendingClarification}
                  onSelect={handleChipSelect}
                />
              )}
              <div className="p-3 sm:p-4 bg-white/70 backdrop-blur-xl border-t ghost-border">
                <ChatInput
                  onSend={handleSend}
                  onStop={handleStopStreaming}
                  isStreaming={isStreaming}
                  disabled={isStreaming}
                  prefillValue={injectedInput}
                  onPrefillConsumed={() => setInjectedInput("")}
                />
              </div>
              {/* Spacer for pane switcher + AppShell bottom tab bar + iOS safe area */}
              <div className="lg:hidden shrink-0" style={{ height: "calc(6rem + env(safe-area-inset-bottom, 0px))" }} aria-hidden="true" />
            </div>
          </>
        )}

        {/* Summary View — no active conversation (welcome state) */}
        {viewMode === "summary" && !activeId && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Command search bar — matches reference's "Awaiting next instruction…" */}
            <div className="px-4 pt-4 pb-1 shrink-0">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                  <button
                    onClick={() => setIsPaletteOpen(true)}
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border-none rounded-2xl text-sm text-left text-on-surface-variant hover:bg-surface-container transition-colors"
                  >
                    Awaiting next instruction…
                  </button>
                </div>
                <button
                  onClick={() => setIsPaletteOpen(true)}
                  className="w-11 h-11 flex items-center justify-center bg-surface-container-low rounded-2xl hover:bg-surface-container transition-colors"
                >
                  <Settings className="w-4 h-4 text-on-surface-variant" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <ChatWelcome onStart={handleSend} />
            </div>
            <div className="shrink-0">
              <div className="p-3 sm:p-4 bg-white/70 backdrop-blur-xl border-t ghost-border">
                <ChatInput
                  onSend={handleSend}
                  onStop={handleStopStreaming}
                  isStreaming={isStreaming}
                  disabled={isStreaming}
                  prefillValue={injectedInput}
                  onPrefillConsumed={() => setInjectedInput("")}
                />
              </div>
              {/* Spacer for pane switcher + AppShell bottom tab bar + iOS safe area */}
              <div className="lg:hidden shrink-0" style={{ height: "calc(6rem + env(safe-area-inset-bottom, 0px))" }} aria-hidden="true" />
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — Active Channels Performance Grid */}
      <div className={cn(
        "shrink-0 h-full transition-all duration-200",
        "lg:flex lg:w-[320px]",
        mobilePane === "reports" ? "flex w-full" : "hidden",
      )}>
        <ErrorBoundary fallbackLabel="Unable to load channels grid">
          <PerformanceGrid onAnalyze={(prompt) => { setViewMode("summary"); setMobilePane("chat"); handleSend(prompt); }} />
        </ErrorBoundary>
      </div>

      </div>{/* end three-pane layout */}

      {approvalOrder.some((id) => approvalCards.get(id)?.status === "pending") && mobilePane !== "chat" && (
        <div
          className="sm:hidden fixed bottom-16 left-0 right-0 z-50 bg-error/90 backdrop-blur-md text-white px-4 py-2 text-center text-sm font-bold cursor-pointer border-t border-error/60 select-none"
          onClick={() => {
            setViewMode("summary");
            setMobilePane("chat");
            setTimeout(() => {
              const firstPending = approvalOrder.find((id) => approvalCards.get(id)?.status === "pending");
              if (firstPending) {
                document.getElementById(`approval-card-${firstPending}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }, 150);
          }}
        >
          {approvalOrder.filter((id) => approvalCards.get(id)?.status === "pending").length} Action{approvalOrder.filter((id) => approvalCards.get(id)?.status === "pending").length !== 1 ? "s" : ""} Awaiting Approval. Tap to view.
        </div>
      )}

      {/* ── Pane Switcher (mobile only) — segmented control above AppShell bottom tab bar ── */}
      <div
        className="lg:hidden fixed left-0 w-full flex justify-around items-center px-4 bg-white/95 backdrop-blur-xl z-40 border-t border-[rgba(200,197,203,0.15)]"
        style={{ bottom: "calc(50px + env(safe-area-inset-bottom, 0px))" }}
      >
        {([
          { key: "radar",   label: "KPIs",    Icon: Activity },
          { key: "chat",    label: "Logs",    Icon: Terminal },
          { key: "reports", label: "Grid",    Icon: LayoutGrid },
        ] as const).map(({ key, label, Icon }) => {
          const isActive = mobilePane === key;
          return (
            <button
              key={key}
              onClick={() => { haptic(); setMobilePane(key); }}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 transition-colors relative min-w-[44px] min-h-[44px]",
                isActive ? "text-accent-blue" : "text-on-surface-variant hover:text-on-surface-variant",
              )}
            >
              {isActive && (
                <span className="absolute top-0 left-2 right-2 h-0.5 bg-accent-blue rounded-full" />
              )}
              <Icon className="w-4 h-4" />
              <span className={cn("text-[9px] font-semibold", isActive ? "text-accent-blue" : "text-on-surface-variant")}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

    </div>

    {/* Glass-Box Approval Modal — intercepts execute clicks for enterprise accountability */}
    <GlassBoxModal
      card={glassBoxPending !== null ? (approvalCards.get(glassBoxPending) ?? null) : null}
      onConfirm={async (snapshotId) => { await handleApprove(snapshotId); }}
      onCancel={() => setGlassBoxPending(null)}
    />

    {/* Auto-Rollback Undo Toast — appears after successful execution */}
    <UndoToast
      action={undoAction}
      onDismiss={() => setUndoAction(null)}
      onReverted={() => {
        if (undoAction) {
          updateCard(undoAction.snapshotId, { status: "reverted" as ApprovalStatus });
        }
      }}
    />

    {/* Value-Gated Paywall — Stripe upgrade modal */}
    <StripeUpgradeModal
      open={stripeModalOpen}
      onClose={() => setStripeModalOpen(false)}
      dollarImpact={stripeContext.dollarImpact}
      actionLabel={stripeContext.actionLabel}
      impactCadence={stripeContext.impactCadence}
    />

    <CommandPalette
      isOpen={isPaletteOpen}
      onClose={() => setIsPaletteOpen(false)}
      onExecute={(prompt) => {
        trackEvent("quick_command_used", { command: prompt.slice(0, 80) });
        setViewMode("summary");
        setMobilePane("chat");
        handleSend(prompt);
      }}
    />

    {/* Onboarding Wizard — blocks screen on first visit; hidden until connections have loaded
        to prevent a flash for returning users opening the app on a new device */}
    {!onboardingComplete && !isLoadingConnections && (
      <OnboardingWizard
        onComplete={markOnboardingComplete}
        onLaunchDiagnostic={() => {
          markOnboardingComplete();
          setViewMode("summary");
          setMobilePane("chat");
          const godModePrompt = "Run the master diagnostic sweep across all connected platforms right now. Execute run_master_diagnostic_sweep and present the full EXECUTIVE SYSTEM DIAGNOSTIC with 🔴 CRITICAL, 🟡 WARNINGS, and 🟢 HEALTHY sections ranked by margin impact. Be terse and decisive.";
          handleSend(godModePrompt);
        }}
      />
    )}
    </>
  );
}


// ─── Terminal Loading State ───────────────────────────────────────────────────

const TERMINAL_PHRASES = [
  "[SYSTEM] Processing telemetry...",
  "[SYSTEM] Interrogating datastores...",
  "[SYSTEM] Formulating execution payload...",
  "[SYSTEM] Cross-referencing ontology...",
  "[SYSTEM] Routing intelligence layer...",
];

function TerminalLoader() {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % TERMINAL_PHRASES.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="px-6 py-4 flex items-center gap-2 text-xs font-mono text-on-secondary-container">
      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-accent-blue/50" />
      <span className="truncate">{TERMINAL_PHRASES[idx]}</span>
    </div>
  );
}

// ─── Inline mini-cards for POAS and Catalog Sweep ────────────────────────────

function POASMetricsCard({ data }: { data: Record<string, unknown> }) {
  const { currencySymbol: sym } = useCurrency();
  const isProfitable = data.isProfitable as boolean;
  return (
    <div className={`mx-4 my-2 rounded-2xl border p-4 ${isProfitable ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-error-container/20"}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold">POAS Analysis</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${isProfitable ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-rose-400 border-rose-500/30 bg-error-container/30"}`}>
          {isProfitable ? "PROFITABLE" : "UNPROFITABLE"}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "POAS", value: `${(data.poas as number).toFixed(2)}x`, color: isProfitable ? "text-emerald-400" : "text-rose-400" },
          { label: "Gross ROAS", value: `${(data.grossROAS as number).toFixed(2)}x`, color: "text-[#60a5fa]" },
          { label: "Net Profit", value: `${sym}${(data.netProfit as number).toFixed(2)}`, color: isProfitable ? "text-emerald-400" : "text-rose-400" },
          { label: "Avg COGS", value: `${sym}${(data.avgCOGS as number).toFixed(2)}`, color: "text-muted-foreground" },
        ].map((m) => (
          <div key={m.label} className="bg-secondary/20 rounded-2xl p-2 text-center">
            <p className={`text-lg font-bold font-mono ${m.color}`}>{m.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span>Ad Spend: <strong className="text-foreground">{sym}{(data.adSpendUsd as number).toFixed(2)}</strong></span>
        <span>Revenue: <strong className="text-foreground">{sym}{(data.adAttributedRevenue as number).toFixed(2)}</strong></span>
        <span>Gross Profit: <strong className="text-foreground">{sym}{(data.grossProfit as number).toFixed(2)}</strong></span>
      </div>
    </div>
  );
}

function CatalogSweepCard({ data }: { data: Record<string, unknown> }) {
  const ontology = data.ontology as Record<string, unknown>;
  const attrs = (ontology.criticalBuyingAttributes as Array<{ attribute: string; description: string; metafieldKey: string; type: string }>) ?? [];
  return (
    <div className="mx-4 my-2 rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold">Vertical Ontology Engine</span>
        <span className="text-xs font-mono px-2 py-0.5 rounded-full border text-teal-400 border-teal-500/30 bg-teal-500/10">
          {String(ontology.detectedVertical)} · {String(ontology.confidence)}% confidence
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{String(ontology.buyerPersona ?? "")}</p>
      {attrs.length > 0 && (
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Recommended Metafield Schema ({attrs.length} {attrs.length === 1 ? "attribute" : "attributes"})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attrs.slice(0, 6).map((a, i) => (
              <div key={i} className="bg-secondary/20 rounded-2xl px-3 py-2 border border-border/30">
                <p className="text-xs font-medium text-foreground">{a.attribute}</p>
                <p className="text-[9px] font-mono text-teal-400">{a.metafieldKey} · {a.type?.split("_field")[0]}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
