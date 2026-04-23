import React, { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Terminal, Copy, FileText, Table, Mail, Link2, Check, Search, Package, RefreshCw, Loader2, Plug, ArrowRight, Zap, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MicroFeedback } from "./micro-feedback";
import { authFetch } from "@/lib/auth-fetch";
import { appendFxAuditToCsv, buildFxAuditTextSection } from "@/lib/fx-audit-csv";
import { CampaignComparisonCard, parseComparisonPayload } from "@/components/shared/CampaignComparisonCard";

interface ActionChipData {
  type: "connect" | "sync" | "navigate" | "run";
  label: string;
  platform?: string;
  path?: string;
  command?: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  onSuggestionClick?: (text: string) => void;
  onProductSelect?: (productId: string, productTitle: string) => void;
  onTriggerSync?: () => void;
  onNavigate?: (path: string) => void;
}

function parseSuggestions(raw: string): { body: string; suggestions: string[] } {
  const marker = /SUGGESTIONS:\s*(\[.*?\])\s*$/s;
  const match = raw.match(marker);
  if (!match) return { body: raw, suggestions: [] };
  try {
    const suggestions = JSON.parse(match[1]) as string[];
    const body = raw.slice(0, match.index).trimEnd();
    return { body, suggestions: Array.isArray(suggestions) ? suggestions : [] };
  } catch {
    return { body: raw, suggestions: [] };
  }
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function messageToCSV(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  return lines.map((line) => `"${line.replace(/"/g, '""')}"`).join("\n");
}

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface CatalogProduct {
  id: string;
  numericId: string;
  title: string;
}

function ProductLookup({ onSelect }: { onSelect: (productId: string, title: string) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProducts = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const url = `${API_BASE}api/warehouse/products?${params}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error("product fetch failed");
      const json = await res.json();
      const rows: Array<{ sku?: string; name?: string }> = Array.isArray(json) ? json : json.data ?? [];
      setProducts(rows.map((r, i) => ({
        id: r.sku ?? String(i),
        numericId: r.sku ?? String(i),
        title: r.name ?? "Untitled Product",
      })));
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts("");
  }, [fetchProducts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProducts(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, fetchProducts]);

  const handleSelect = (product: CatalogProduct) => {
    setSelected(product.numericId);
    onSelect(product.numericId, product.title);
  };

  return (
    <div className="mt-3 border border-outline-variant/20 bg-surface-container-lowest overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b ghost-border bg-surface-container-low">
        <Package className="w-3 h-3 text-accent-blue shrink-0" />
        <span className="text-[10px] font-bold text-accent-blue uppercase tracking-widest">
          Catalog Lookup — Select a Product
        </span>
      </div>
      <div className="p-2">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog..."
            className="w-full pl-8 pr-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-2xl text-xs text-on-surface placeholder:text-on-surface-variant outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/15 transition-all"
            autoFocus
          />
        </div>
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3">
              <Loader2 className="w-3 h-3 animate-spin text-accent-blue" />
              <span className="text-[11px] text-on-surface-variant">Loading products…</span>
            </div>
          )}
          {!loading && products.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p)}
              className={cn(
                "w-full flex items-center justify-between px-2.5 py-2 rounded-2xl text-left text-xs transition-colors",
                selected === p.numericId
                  ? "bg-accent-blue/10 text-accent-blue border border-accent-blue/30"
                  : "text-on-surface hover:bg-surface border border-transparent",
              )}
            >
              <span className="truncate">{p.title}</span>
              <span className="ml-2 text-[10px] text-on-surface-variant shrink-0">#{p.numericId}</span>
            </button>
          ))}
          {!loading && products.length === 0 && (
            <p className="text-center text-[11px] text-on-surface-variant py-3">No products found</p>
          )}
        </div>
        {selected && (
          <div className="mt-2 px-2.5 py-1.5 bg-accent-blue/8 border border-accent-blue/20 rounded-2xl text-[10px] font-medium text-accent-blue">
            Product ID <span className="text-on-surface font-bold">{selected}</span> injected into input
          </div>
        )}
      </div>
    </div>
  );
}

const ACTION_ITEMS = [
  { Icon: Copy,     label: "Copy",             key: "copy" },
  { Icon: FileText, label: "Export to Docs",   key: "docs" },
  { Icon: Table,    label: "Export to Sheets", key: "sheets" },
  { Icon: Mail,     label: "Email",            key: "email" },
  { Icon: Link2,    label: "Share URL",        key: "share" },
] as const;

function SyncButton({ onSync }: { onSync: () => void }) {
  const [triggered, setTriggered] = useState(false);
  return (
    <button
      onClick={() => { setTriggered(true); onSync(); }}
      disabled={triggered}
      aria-label={triggered ? "Sync in progress" : "Sync agent action with platform"}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all mt-2",
        triggered
          ? "bg-accent-blue/10 text-accent-blue border border-accent-blue/20 cursor-default"
          : "bg-accent-blue text-white hover:bg-accent-blue/90 shadow-sm active:scale-[0.97]",
      )}
    >
      {triggered ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5" />
      )}
      {triggered ? "Sync triggered…" : "Trigger Manual Sync"}
    </button>
  );
}

const SYNC_PATTERN = /(?:type\s+['"]?sync the warehouse['"]?|['"]sync the warehouse['"])/i;

const ACTION_CHIP_ICONS: Record<string, React.ReactNode> = {
  connect: <Plug className="w-3.5 h-3.5" />,
  sync: <RefreshCw className="w-3.5 h-3.5" />,
  navigate: <ArrowRight className="w-3.5 h-3.5" />,
  run: <Zap className="w-3.5 h-3.5" />,
};

const ACTION_CHIP_STYLES: Record<string, string> = {
  connect: "bg-primary-container text-white hover:bg-primary-container/90",
  sync: "bg-accent-blue text-white hover:bg-accent-blue/90",
  navigate: "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
  run: "bg-emerald-600 text-white hover:bg-emerald-700",
};

const CONNECT_PATTERN = /(?:connect|link)\s+(?:your\s+)?(\w[\w\s]*?)\s+(?:account|platform)\s+(?:from|on|via)\s+the\s+Connections?\s+page/gi;
const SYNC_CMD_PATTERN = /(?:type|enter|run)\s+['"`]([^'"`]+)['"`]/gi;
const NAVIGATE_PATTERN = /(?:go to|visit|navigate to|open)\s+(?:the\s+)?(\w[\w\s]*?)\s+(?:page|section|tab|panel)/gi;

function extractActionChips(body: string): { cleanBody: string; chips: ActionChipData[] } {
  const chips: ActionChipData[] = [];
  let clean = body;

  let match: RegExpExecArray | null;
  
  CONNECT_PATTERN.lastIndex = 0;
  while ((match = CONNECT_PATTERN.exec(body)) !== null) {
    const platform = match[1].trim();
    chips.push({
      type: "connect",
      label: `Connect ${platform}`,
      platform: platform.toLowerCase().replace(/\s+/g, "_"),
      path: "/connections",
    });
  }
  if (chips.some(c => c.type === "connect")) {
    clean = clean.replace(CONNECT_PATTERN, "use the button below");
  }

  SYNC_CMD_PATTERN.lastIndex = 0;
  while ((match = SYNC_CMD_PATTERN.exec(body)) !== null) {
    const cmd = match[1].trim();
    if (cmd.toLowerCase().includes("sync")) {
      chips.push({
        type: "sync",
        label: "Run Master Sync",
        command: cmd,
      });
    } else {
      chips.push({
        type: "run",
        label: cmd.length > 30 ? cmd.slice(0, 27) + "..." : cmd,
        command: cmd,
      });
    }
  }
  if (chips.some(c => c.type === "sync" || c.type === "run")) {
    clean = clean.replace(SYNC_CMD_PATTERN, "use the button below");
  }

  return { cleanBody: clean, chips };
}

function ActionChips({ chips, onNavigate, onSync }: { chips: ActionChipData[]; onNavigate?: (path: string) => void; onSync?: () => void }) {
  const [triggered, setTriggered] = useState<Set<number>>(new Set());
  if (chips.length === 0) return null;

  const handleClick = (chip: ActionChipData, idx: number) => {
    setTriggered((prev) => new Set(prev).add(idx));
    if (chip.type === "connect" && chip.path && onNavigate) {
      onNavigate(chip.path);
    } else if (chip.type === "sync" && onSync) {
      onSync();
    } else if (chip.type === "navigate" && chip.path && onNavigate) {
      onNavigate(chip.path);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip, idx) => {
        const done = triggered.has(idx);
        return (
          <button
            key={idx}
            onClick={() => handleClick(chip, idx)}
            disabled={done}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all shadow-sm",
              done
                ? "bg-surface-container-low text-on-surface-variant border border-outline-variant/20 cursor-default"
                : ACTION_CHIP_STYLES[chip.type] ?? ACTION_CHIP_STYLES.navigate,
              !done && "active:scale-[0.97]",
            )}
          >
            {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : ACTION_CHIP_ICONS[chip.type]}
            {done ? (chip.type === "connect" ? "Opening Connections…" : "Triggered") : chip.label}
          </button>
        );
      })}
    </div>
  );
}

function renderBodyWithSyncButton(body: string, onSync?: () => void): { cleanBody: string; hasSyncCTA: boolean } {
  if (!onSync) return { cleanBody: body, hasSyncCTA: false };
  if (SYNC_PATTERN.test(body)) {
    const cleanBody = body.replace(SYNC_PATTERN, "use the button below");
    return { cleanBody, hasSyncCTA: true };
  }
  return { cleanBody: body, hasSyncCTA: false };
}

function stripJsonBlock(content: string, jsonStr: string): string {
  const escaped = jsonStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content
    .replace(new RegExp("```(?:json)?\\s*" + escaped + "\\s*```", "s"), "")
    .replace(jsonStr, "")
    .trim();
}

export const ChatMessage = React.memo(function ChatMessage({ role, content, onSuggestionClick, onProductSelect, onTriggerSync, onNavigate }: ChatMessageProps) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const comparisonPayload = !isUser ? parseComparisonPayload(content) : null;

  const { body: rawBody, suggestions } = isUser ? { body: content, suggestions: [] } : parseSuggestions(content);

  const { cleanBody: syncCleanBody, hasSyncCTA } = isUser
    ? { cleanBody: rawBody, hasSyncCTA: false }
    : renderBodyWithSyncButton(rawBody, onTriggerSync);

  const { cleanBody: bodyBeforeComparisonStrip, chips: actionChips } = isUser
    ? { cleanBody: syncCleanBody, chips: [] as ActionChipData[] }
    : extractActionChips(syncCleanBody);

  const body = comparisonPayload
    ? stripJsonBlock(bodyBeforeComparisonStrip, JSON.stringify(comparisonPayload))
    : bodyBeforeComparisonStrip;

  const needsProductLookup = !isUser && body.includes("Missing parameter: Product ID");

  const handleAction = async (key: string) => {
    switch (key) {
      case "copy": {
        const fxSuffix = buildFxAuditTextSection();
        const exportText = fxSuffix ? `${body}\n${fxSuffix}` : body;
        await navigator.clipboard.writeText(exportText).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        break;
      }
      case "docs":
        triggerDownload(`${body}${buildFxAuditTextSection()}`, "OMNI_OUTPUT.doc", "text/plain");
        break;
      case "sheets":
        triggerDownload(appendFxAuditToCsv(messageToCSV(body)), "OMNI_DATA.csv", "text/csv");
        break;
      case "email":
        window.open(
          `mailto:?subject=${encodeURIComponent("OmniAnalytix Report")}&body=${encodeURIComponent(body)}`,
          "_blank",
        );
        break;
      case "share":
        await navigator.clipboard.writeText(`${window.location.href}#share-placeholder`).catch(() => {});
        setShared(true);
        setTimeout(() => setShared(false), 2000);
        break;
    }
  };

  return (
    <div className={cn(
      "py-4 px-4 md:px-8 flex w-full",
      isUser ? "justify-end" : "justify-start",
    )}>
      <div className={cn(
        "flex gap-3",
        isUser ? "max-w-[85%] flex-row-reverse" : "max-w-4xl w-full",
      )}>
        <div className="flex-shrink-0 mt-1">
          {isUser ? (
            <div className="w-7 h-7 bg-primary-container rounded-full flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-white" />
            </div>
          ) : (
            <div className="w-7 h-7 bg-surface-container rounded-full flex items-center justify-center border border-outline-variant/20">
              <Terminal className="w-3.5 h-3.5 text-primary-container" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "bg-primary-container text-white rounded-br-sm prose-p:text-white/90 prose-strong:text-white prose-headings:text-white prose-code:text-white/80"
              : "bg-surface-container-lowest border ghost-border",
          )}>
            <div className={cn(
              "prose max-w-none prose-p:leading-relaxed prose-pre:rounded-2xl",
              isUser
                ? "prose-pre:bg-white/10 prose-pre:border-white/10 prose-code:text-white/80 prose-a:text-white/90 prose-a:underline"
                : "prose-pre:bg-surface-container-low prose-pre:border prose-pre:border-outline-variant/15 prose-code:text-accent-blue prose-a:text-accent-blue prose-headings:text-on-surface prose-p:text-on-surface-variant prose-li:text-on-surface-variant prose-strong:text-on-surface",
            )}>
              {body.trim() && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: (props) => (
                      <div className="my-3 overflow-x-auto rounded-lg border border-outline-variant/20">
                        <table {...props} className="min-w-full text-xs border-collapse" />
                      </div>
                    ),
                    thead: (props) => <thead {...props} className="bg-surface-container-low" />,
                    th: (props) => <th {...props} className="px-3 py-2 text-left font-semibold text-on-surface border-b border-outline-variant/20 whitespace-nowrap" />,
                    td: (props) => <td {...props} className="px-3 py-2 text-on-surface-variant border-b border-outline-variant/10 align-top" />,
                    tr: (props) => <tr {...props} className="hover:bg-surface-container-low/50" />,
                  }}
                >{body}</ReactMarkdown>
              )}
            </div>
            {comparisonPayload && (
              <div className="mt-3">
                <CampaignComparisonCard payload={comparisonPayload} />
              </div>
            )}
          </div>

          {hasSyncCTA && onTriggerSync && (
            <SyncButton onSync={onTriggerSync} />
          )}

          {actionChips.length > 0 && (
            <ActionChips chips={actionChips} onNavigate={onNavigate} onSync={onTriggerSync} />
          )}

          {needsProductLookup && onProductSelect && (
            <ProductLookup onSelect={onProductSelect} />
          )}

          {!isUser && (
            <div className="mt-3">
              <div className="flex items-center gap-0.5">
                {ACTION_ITEMS.map(({ Icon, label, key }) => {
                  const isActive = (key === "copy" && copied) || (key === "share" && shared);
                  return (
                    <button
                      key={key}
                      onClick={() => handleAction(key)}
                      title={label}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-2xl text-[11px] text-on-secondary-container hover:text-on-surface hover:bg-surface-container-low transition-colors"
                    >
                      {isActive
                        ? <Check className="w-3 h-3 text-emerald-600" />
                        : <Icon className="w-3 h-3" />
                      }
                      <span className="hidden sm:inline">
                        {key === "copy" && copied ? "Copied" : key === "share" && shared ? "Copied!" : label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <MicroFeedback messageExcerpt={body.slice(0, 200)} />
            </div>
          )}

          {!isUser && suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((text, i) => (
                <button
                  key={i}
                  onClick={() => onSuggestionClick?.(text)}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface hover:text-on-surface hover:border-accent-blue/30 transition-all duration-150"
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
