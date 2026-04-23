import React, { useState, useEffect, useCallback } from "react";
import { ChevronRight, Zap, ShieldAlert, BarChart2, Lightbulb, Keyboard, X, Rocket } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

export interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  prompt: string;
  category: string;
  icon?: React.ReactNode;
  tag?: string;
  godMode?: boolean;
  featured?: boolean;
}

const GROUPS: { key: string; label: string; icon: React.ReactNode; color: string; badgeClass: string }[] = [
  {
    key: "diagnostics",
    label: "Diagnostics",
    icon: <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.75} />,
    color: "text-rose-600",
    badgeClass: "bg-rose-50 text-rose-600 border-rose-200/60",
  },
  {
    key: "reporting",
    label: "Reporting",
    icon: <BarChart2 className="w-3.5 h-3.5" strokeWidth={1.75} />,
    color: "text-blue-600",
    badgeClass: "bg-blue-50 text-blue-600 border-blue-200/60",
  },
  {
    key: "optimization",
    label: "Optimization",
    icon: <Lightbulb className="w-3.5 h-3.5" strokeWidth={1.75} />,
    color: "text-amber-500",
    badgeClass: "bg-amber-50 text-amber-600 border-amber-200/60",
  },
  {
    key: "navigation",
    label: "Quick Navigation",
    icon: <Rocket className="w-3.5 h-3.5" strokeWidth={1.75} />,
    color: "text-violet-600",
    badgeClass: "bg-violet-50 text-violet-600 border-violet-200/60",
  },
];

const COMMANDS: PaletteCommand[] = [
  {
    id: "open-copilot", category: "diagnostics", featured: true,
    label: "Open AI Assistant",
    description: "Slide open OmniCopilot — context-aware AI for this dashboard",
    prompt: "__open_copilot__",
    tag: "Copilot",
    icon: <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>,
  },
  {
    id: "god-mode-sweep", category: "diagnostics", godMode: true, featured: true,
    label: "Run Master Diagnostic Sweep",
    description: "Full-ecosystem audit across all connected platforms",
    prompt: "Run the master diagnostic sweep across all connected platforms right now. Execute run_master_diagnostic_sweep and present the full EXECUTIVE SYSTEM DIAGNOSTIC with 🔴 CRITICAL, 🟡 WARNINGS, and 🟢 HEALTHY sections ranked by margin impact. Be terse and decisive.",
    tag: "God Mode",
  },
  {
    id: "poas-metrics", category: "diagnostics", featured: true,
    label: "POAS Profitability Analysis",
    description: "True profitability: revenue minus COGS, fees, shipping",
    prompt: "Compute POAS metrics for the store. Show ROAS vs POAS side by side and flag any campaigns that are ROAS-positive but POAS-negative.",
    tag: "POAS",
  },
  {
    id: "pmax-xray", category: "diagnostics", featured: true,
    label: "PMax X-Ray: Network Split",
    description: "Visualize PMax budget allocation across Search/Shopping/Display/Video",
    prompt: "Run a PMax X-Ray to show how the Performance Max budget is splitting across Search, Shopping, Display, and Video networks. Flag any cannibalization risk.",
    tag: "PMax",
  },
  {
    id: "predict-stockouts", category: "diagnostics",
    label: "Predict Inventory Stockouts",
    description: "Calculate days until stockout for all active products",
    prompt: "Predict stockouts across all active products. Show daily run rate and days remaining for every product at risk.",
    tag: "Shopify",
  },
  {
    id: "predict-gmc-disapprovals", category: "diagnostics",
    label: "Fix Merchant Center Errors",
    description: "Audit Shopify vs GMC for mismatch-triggered policy violations",
    prompt: "Predict GMC disapprovals by auditing the Shopify product data against the Google Merchant Center feed. Show all mismatches ranked by severity.",
    tag: "GMC",
  },
  {
    id: "preflight-audit", category: "diagnostics",
    label: "Pre-Flight Compliance Audit",
    description: "Scan a landing page before campaign launch",
    prompt: "Run a pre-flight compliance audit on our landing page URL before campaign launch. Check for Google Ads, Meta, and GMC policy violations.",
    tag: "Compliance",
  },

  {
    id: "weekly-pdf", category: "reporting", featured: true,
    label: "Generate Weekly PDF Report",
    description: "Download the Client Whisperer PDF narrative",
    prompt: "Generate and download the weekly PDF performance report with narrative summary, platform breakdowns, and recommended actions.",
    tag: "Report",
  },
  {
    id: "qbr-deck", category: "reporting", featured: true,
    label: "Generate QBR Deck",
    description: "Build a multi-slide PPTX for client quarterly review",
    prompt: "Generate the Quarterly Business Review PPTX deck with cross-platform metrics, predictive charts, and executive narrative.",
    tag: "Report",
  },
  {
    id: "forensic-audit", category: "reporting", featured: true,
    label: "Full Forensic Audit",
    description: "End-to-end 5-step audit across all connected platforms",
    prompt: "Run the full 5-step forensic audit: Intel Gathering, Forensic Audit of every channel, Competitive Intelligence, Strategy Formulation, and Exact Implementation artifacts.",
    tag: "Audit",
  },
  {
    id: "roas-analysis", category: "reporting",
    label: "Full ROAS / POAS Analysis",
    description: "Side-by-side ROAS vs POAS across all campaigns",
    prompt: "Show me a full ROAS and POAS analysis across all connected campaigns. Highlight any campaigns where ROAS looks healthy but POAS is negative.",
    tag: "Audit",
  },

  {
    id: "budget-constraints", category: "optimization", featured: true,
    label: "Find Capped Campaigns (Scale Up)",
    description: "Find profitable campaigns artificially capped by budget",
    prompt: "Identify all budget-constrained campaigns with positive ROAS. Show estimated missed revenue per campaign and recommended budget increases.",
    tag: "Google Ads",
  },
  {
    id: "ad-copy-matrix", category: "optimization", featured: true,
    label: "Generate Ad Copy Matrix",
    description: "5 hooks × 3 descriptions bulk matrix ranked by fit score",
    prompt: "Generate a full ad copy matrix (5 hooks × 3 descriptions) optimized for our product. Rank each combination by fit score and highlight the top variant.",
    tag: "Vertex AI",
  },
  {
    id: "creative-autopsy", category: "optimization", featured: true,
    label: "Creative Autopsy",
    description: "Multimodal AI analysis of ad creatives — CTR correlation",
    prompt: "Run a Creative Autopsy on our active ad images. Analyze visual entities, mood, and complexity then correlate with CTR and conversion data.",
    tag: "Vertex AI",
  },
  {
    id: "customer-match", category: "optimization",
    label: "Push High-LTV Customer Match",
    description: "Upload hashed emails to Google Ads Customer Match list",
    prompt: "Calculate high-LTV customers and push their hashed emails to a Google Ads Customer Match list for bid boosting and lookalike expansion.",
    tag: "Google Ads",
  },
  {
    id: "sge-optimize", category: "optimization",
    label: "Optimize SGE Metadata",
    description: "Rewrite product description for AI Shopping Graph discovery",
    prompt: "Optimize the product description for SGE (Search Generative Experience) and AI Shopping Graph. Rewrite with entity-dense semantic HTML and propose structured metafields.",
    tag: "SEO",
  },
  {
    id: "page2-blog", category: "optimization",
    label: "Generate Blog for Page 2 Keywords",
    description: "Identify ranking 4-20 queries and create an SEO blog post",
    prompt: "Find all queries ranking positions 4-20 in Search Console and generate a fully optimized blog post targeting the highest-opportunity keyword cluster.",
    tag: "GSC",
  },

  // ── Quick Navigation ──────────────────────────────────────────────────────
  {
    id:          "nav-build-agent",
    category:    "navigation",
    featured:    true,
    label:       "Build Agent",
    description: "Open the AI Agent Builder — create custom RAG-powered agents",
    prompt:      "__navigate__/agent-builder",
    tag:         "Agent Builder",
    icon:        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>,
  },
  {
    id:          "nav-enrich-feed",
    category:    "navigation",
    featured:    true,
    label:       "Enrich Feed",
    description: "Open Feed Enrichment — AI-rewrite product titles, descriptions & attributes",
    prompt:      "__navigate__/feed-enrichment",
    tag:         "Feed AI",
    icon:        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_fix_high</span>,
  },
  {
    id:          "nav-promo-engine",
    category:    "navigation",
    label:       "Promo Intelligence",
    description: "Open the Promotional Intelligence Engine — auto flash-sale triggers",
    prompt:      "__navigate__/promo-engine",
    tag:         "Promo Engine",
    icon:        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>,
  },
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (prompt: string) => void;
}

const KBD_SHORTCUTS = [
  { keys: ["↵"],         label: "Execute command" },
  { keys: ["↑", "↓"],   label: "Navigate list" },
  { keys: ["Esc"],       label: "Close palette" },
  { keys: ["⌘", "K"],   label: "Open palette" },
  { keys: ["⌘", "F"],   label: "Focus search" },
];

function CommandPaletteContent({ onClose, onExecute }: Omit<CommandPaletteProps, "isOpen">) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleExecute = useCallback(
    (cmd: PaletteCommand) => {
      onClose();
      if (cmd.prompt === "__open_copilot__") {
        setTimeout(() => window.dispatchEvent(new CustomEvent("omni:open-copilot")), 120);
        return;
      }
      if (cmd.prompt.startsWith("__navigate__")) {
        const path = cmd.prompt.slice("__navigate__".length);
        setTimeout(() => {
          window.history.pushState({}, "", path);
          window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
        }, 80);
        return;
      }
      setTimeout(() => onExecute(cmd.prompt), 80);
    },
    [onClose, onExecute],
  );

  return (
    <Command className="rounded-2xl bg-white" shouldFilter={true}>
      <div className="px-5 pt-4 pb-2.5 border-b ghost-border">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-[15px] font-bold text-on-surface tracking-tight">Prompt Library</h2>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Pre-built AI commands organized by workflow</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface transition-colors text-on-surface-variant"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <CommandInput placeholder="Search prompts…" className="text-sm" autoFocus />
      <CommandList className="max-h-[400px] px-2 py-1">
        <CommandEmpty className="py-8 text-center text-xs text-on-surface-variant">
          No commands match your search
        </CommandEmpty>
        {GROUPS.map((group, gi) => (
          <React.Fragment key={group.key}>
            {gi > 0 && <div className="my-1" />}
            <CommandGroup
              heading={
                <span className="flex items-center gap-2 px-1 mt-2 mb-0.5">
                  <span className={cn("cmd-category-badge border", group.badgeClass)}>
                    {group.icon}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
                    {group.label}
                  </span>
                </span>
              }
            >
              {COMMANDS.filter((c) => c.category === group.key).map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={`${cmd.label} ${cmd.description} ${cmd.tag ?? ""}`}
                  onSelect={() => handleExecute(cmd)}
                  className={cn(
                    "group flex items-center gap-3 py-2.5 px-3 rounded-2xl cursor-pointer min-h-[44px] border border-transparent transition-colors",
                    "hover:bg-surface data-[selected=true]:bg-surface data-[selected=true]:border-outline-variant/15/60",
                    cmd.godMode && "data-[selected=true]:bg-amber-50/60 data-[selected=true]:border-amber-200/60",
                  )}
                >
                  <div className="w-1 self-stretch rounded-full shrink-0 bg-transparent group-data-[selected=true]:bg-primary-container transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[13px] font-medium truncate text-on-surface",
                        cmd.godMode && "text-amber-700",
                      )}>
                        {cmd.godMode && "⚡ "}{cmd.label}
                      </span>
                      {cmd.tag && (
                        <span className="text-[9px] font-mono uppercase tracking-widest rounded-md px-1.5 py-0.5 shrink-0 border text-on-surface-variant border-outline-variant/15 bg-surface">
                          {cmd.tag}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] truncate mt-0.5 text-on-surface-variant">{cmd.description}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-outline-variant" />
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>

      {/* Footer */}
      <div className="border-t ghost-border shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {/* Keyboard shortcuts panel */}
        <AnimatePresence>
          {showShortcuts && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="px-5 py-3 border-b ghost-border bg-surface/60">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">Keyboard Shortcuts</p>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                  {KBD_SHORTCUTS.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {s.keys.map((k) => (
                          <kbd key={k} className="text-[10px] font-mono bg-white border border-outline-variant/25 rounded px-1.5 py-0.5 shadow-sm">{k}</kbd>
                        ))}
                      </div>
                      <span className="text-[10px] text-on-surface-variant">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="px-4 py-2.5 flex items-center justify-between">
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 text-[10px] font-medium rounded-lg px-2 py-1 transition-colors",
              showShortcuts
                ? "bg-surface text-on-surface border border-outline-variant/15"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface",
            )}
          >
            <Keyboard className="w-3 h-3" />
            Shortcuts
          </button>
          <span className="text-[10px] font-mono text-on-surface-variant">
            {COMMANDS.length} commands
          </span>
        </div>
      </div>
    </Command>
  );
}

export function CommandPalette({ isOpen, onClose, onExecute }: CommandPaletteProps) {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent side="bottom" className="rounded-t-lg p-0 max-h-[92dvh]">
          <SheetTitle className="sr-only">Prompt Library</SheetTitle>
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-9 h-1 rounded-full bg-[#c8c5cb]" />
          </div>
          <CommandPaletteContent onClose={onClose} onExecute={onExecute} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden rounded-2xl shadow-xl border-outline-variant/15" style={{ maxHeight: "70vh" }}>
        <CommandPaletteContent onClose={onClose} onExecute={onExecute} />
      </DialogContent>
    </Dialog>
  );
}

export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl text-[10px] font-medium border border-outline-variant/30 text-on-secondary-container hover:bg-surface-container-low transition-colors duration-150 min-h-[44px] min-w-[44px] justify-center"
      title="Command Palette (⌘K)"
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94, backgroundColor: "rgba(0,91,191,0.08)" }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      style={{ willChange: "transform" }}
    >
      <motion.span
        whileTap={{ rotate: -15 }}
        transition={{ duration: 0.12 }}
      >
        <Zap className="w-3 h-3" />
      </motion.span>
      <span className="hidden sm:inline">Commands</span>
      <kbd className="hidden sm:inline text-[9px] font-mono text-on-surface-variant bg-surface border border-outline-variant/15 rounded px-1">⌘K</kbd>
    </motion.button>
  );
}
