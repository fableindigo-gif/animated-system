import { useState, useEffect, useRef } from "react";
import { X, ChevronDown, HelpCircle, Bug, Webhook, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── FAQ Data ─────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "How do I connect my Google Ads account?",
    a: "Go to the Connections page (accessible via the left sidebar). Click 'Connect Google Workspace', authorise with your Google account, then select your Google Ads MCC or client account. Your credentials are stored encrypted.",
  },
  {
    q: "What is POAS and how does it differ from ROAS?",
    a: "ROAS (Return on Ad Spend) = Revenue ÷ Ad Spend. It ignores product costs, returns, and fulfilment. POAS (Profit on Ad Spend) = Gross Profit ÷ Ad Spend. It uses actual margins to show true profitability. A campaign can be ROAS-positive but POAS-negative if margins are thin.",
  },
  {
    q: "How does the ⌘K Command Palette work?",
    a: "Press ⌘K (Mac) or Ctrl+K (Windows/Linux) from anywhere in the platform. A searchable menu of 35+ pre-built AI commands appears. Select any command to immediately trigger it in the AI chat. You can also type a partial keyword to filter commands.",
  },
  {
    q: "What does Live Triage analyse?",
    a: "Live Triage checks three critical signals in real time: (1) Budget-constrained campaigns that are capped and losing revenue, (2) Zero-impression campaigns wasting budget, and (3) Automation churn — campaigns that dropped off AI bidding in the last 7 days. It auto-refreshes every 5 minutes.",
  },
  {
    q: "How do I connect Shopify?",
    a: "From the Connections page, click 'Connect Shopify'. Enter your Shopify store URL (e.g. my-store.myshopify.com) and a Private App access token with read_products, read_orders, and write_products scopes. OmniAnalytix never stores your Shopify admin password.",
  },
  {
    q: "What platforms does OmniAnalytix support?",
    a: "Currently: Google Ads, Shopify, Google Merchant Center (via Google Workspace), Google Search Console, and YouTube. Meta Ads integration is in beta. More platforms are being added based on user feedback.",
  },
];

// ─── Tab Components ────────────────────────────────────────────────────────────

function AccordionItem({ item, open, onToggle }: {
  item: typeof FAQ_ITEMS[0];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cn("border-b border-outline-variant/15/60 last:border-0", open && "bg-white/40")}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/30"
      >
        <span className="text-xs font-medium text-on-surface leading-relaxed">{item.q}</span>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-on-surface-variant shrink-0 transition-transform",
          open && "rotate-180",
        )} />
      </button>
      {open && (
        <div className="px-4 pb-3">
          <p className="text-xs text-on-surface-variant leading-relaxed">{item.a}</p>
        </div>
      )}
    </div>
  );
}

function FaqTab() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-3 pb-2">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Frequently Asked Questions</p>
      </div>
      <div className="divide-y divide-on-surface/40">
        {FAQ_ITEMS.map((item, i) => (
          <AccordionItem
            key={i}
            item={item}
            open={openIdx === i}
            onToggle={() => setOpenIdx(openIdx === i ? null : i)}
          />
        ))}
      </div>
      <div className="px-4 py-4 border-t border-outline-variant/15/60 mt-2">
        <a
          href="mailto:support@omnianalytix.in"
          className="flex items-center gap-2 text-xs text-accent-blue hover:text-cyan-300 transition-colors font-mono"
        >
          <ExternalLink className="w-3 h-3" />
          Email support@omnianalytix.in
        </a>
      </div>
    </div>
  );
}

type SubmitState = "idle" | "submitting" | "success" | "error";

function BugReporterTab({ webhookUrl, onWebhookUrlChange }: {
  webhookUrl: string;
  onWebhookUrlChange: (url: string) => void;
}) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [savedWebhook, setSavedWebhook] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !description.trim()) return;
    setSubmitState("submitting");
    try {
      const resp = await authFetch(`${API_BASE}api/system/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description }),
      });
      if (resp.ok) {
        setSubmitState("success");
        setDescription("");
        setCategory("");
        setTimeout(() => setSubmitState("idle"), 3000);
      } else {
        setSubmitState("error");
      }
    } catch {
      setSubmitState("error");
    }
  };

  const handleSaveWebhook = async () => {
    if (!webhookUrl.trim()) return;
    try {
      await authFetch(`${API_BASE}api/system/alerts/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      setSavedWebhook(true);
      setTimeout(() => setSavedWebhook(false), 2000);
    } catch { /* silent */ }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">

      {/* Bug Reporter */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Report a Bug or Feedback</p>

        <div>
          <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider block mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-white border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface font-mono outline-none focus:border-cyan-500/50 transition-colors"
          >
            <option value="">Select category…</option>
            <option value="ui_bug">UI / Visual Bug</option>
            <option value="api_error">API / Data Error</option>
            <option value="connection_issue">Platform Connection Issue</option>
            <option value="ai_response">AI Response Quality</option>
            <option value="feature_request">Feature Request</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Describe what happened, what you expected, and steps to reproduce…"
            className="w-full bg-white border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface-variant font-mono outline-none focus:border-cyan-500/50 resize-none transition-colors placeholder:text-on-surface-variant"
          />
        </div>

        <button
          type="submit"
          disabled={!category || !description.trim() || submitState === "submitting"}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2 rounded-2xl text-xs font-mono font-bold transition-all",
            submitState === "success"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : submitState === "error"
              ? "bg-error-container/20 text-rose-400 border border-rose-500/30"
              : "bg-primary-container hover:bg-primary-container text-on-surface disabled:opacity-40",
          )}
        >
          {submitState === "submitting" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {submitState === "success" && <CheckCircle2 className="w-3.5 h-3.5" />}
          {submitState === "error" && <AlertCircle className="w-3.5 h-3.5" />}
          {submitState === "idle" && "Submit Report"}
          {submitState === "submitting" && "Sending…"}
          {submitState === "success" && "Submitted! Thank you."}
          {submitState === "error" && "Failed — try again"}
        </button>
      </form>

      {/* Webhook Settings */}
      <div className="pt-3 border-t border-outline-variant/15/60 space-y-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Proactive Alert Webhook</p>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Enter a Slack or Teams webhook URL. Critical Live Triage alerts (e.g. POAS drops) will be pushed here automatically.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => onWebhookUrlChange(e.target.value)}
            placeholder="https://hooks.slack.com/…"
            className="flex-1 bg-white border border-outline-variant/15 rounded-2xl px-3 py-2 text-xs text-on-surface font-mono outline-none focus:border-cyan-500/50 transition-colors placeholder:text-on-surface-variant"
          />
          <button
            onClick={handleSaveWebhook}
            disabled={!webhookUrl.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-mono font-bold bg-surface border border-outline-variant/15 text-on-surface-variant hover:border-outline disabled:opacity-40 transition-all shrink-0"
          >
            <Webhook className="w-3 h-3" />
            {savedWebhook ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main HelpDrawer ──────────────────────────────────────────────────────────

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDrawer({ open, onClose }: HelpDrawerProps) {
  const [tab, setTab] = useState<"faq" | "bug">("faq");
  const [webhookUrl, setWebhookUrl] = useState(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("omni_webhook_url") ?? "" : "",
  );

  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("omni_webhook_url", webhookUrl);
    }
  }, [webhookUrl]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[900] bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          "fixed right-0 top-0 bottom-0 z-[901] w-full sm:w-80 max-w-sm bg-surface border-l border-outline-variant/15 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-outline-variant/15 shrink-0">
          <HelpCircle className="w-4 h-4 text-accent-blue shrink-0" />
          <span className="flex-1 text-sm font-bold text-on-surface font-mono">Help & Support</span>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-outline-variant/15 shrink-0">
          <button
            onClick={() => setTab("faq")}
            className={cn(
              "flex-1 py-2.5 text-[11px] font-mono uppercase tracking-widest transition-colors",
              tab === "faq"
                ? "text-accent-blue border-b-2 border-cyan-400"
                : "text-on-surface-variant hover:text-on-surface-variant",
            )}
          >
            FAQ
          </button>
          <button
            onClick={() => setTab("bug")}
            className={cn(
              "flex-1 py-2.5 text-[11px] font-mono uppercase tracking-widest transition-colors flex items-center justify-center gap-1.5",
              tab === "bug"
                ? "text-accent-blue border-b-2 border-cyan-400"
                : "text-on-surface-variant hover:text-on-surface-variant",
            )}
          >
            <Bug className="w-3 h-3" />
            Report
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {tab === "faq" ? <FaqTab /> : (
            <BugReporterTab
              webhookUrl={webhookUrl}
              onWebhookUrlChange={setWebhookUrl}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Persistent [?] trigger button ────────────────────────────────────────────

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Help & Support"
      className="flex items-center justify-center w-7 h-7 rounded-full bg-surface border border-outline-variant/15 text-on-surface-variant hover:border-outline hover:text-on-surface transition-all text-xs font-bold font-mono shrink-0"
    >
      ?
    </button>
  );
}
