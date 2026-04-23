import { useState, useEffect, useRef } from "react";
import { X, ChevronDown, BookOpen, Zap, BarChart3, Link2, Shield, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FaqDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FaqItem {
  question: string;
  answer: string;
  details?: string[];
}

interface FaqCategory {
  title: string;
  icon: React.ReactNode;
  items: FaqItem[];
}

const FAQ_CATEGORIES: FaqCategory[] = [
  {
    title: "Getting Started",
    icon: <Zap className="w-3.5 h-3.5 text-primary-container" />,
    items: [
      {
        question: "How do I connect my Google Ads account?",
        answer: "Navigate to the Connections page from the sidebar. Click \"Configure Sync Settings\" under Google Workspace, then sign in with your Google account.",
        details: [
          "You'll need Admin or Standard access to your Google Ads account.",
          "OmniAnalytix requests read-only scopes by default; write scopes are needed for automated optimizations.",
          "After authorizing, the ETL pipeline will begin syncing your campaign data automatically.",
        ],
      },
      {
        question: "How do I connect Shopify?",
        answer: "Navigate to the Connections page and find the Shopify section. Click \"Authorize with Shopify\" and enter your store's .myshopify.com domain.",
        details: [
          "You'll be redirected to Shopify to approve the required read/write scopes.",
          "Store Owner or Staff with Apps permission is required.",
          "Product, order, and inventory data will begin syncing within minutes.",
        ],
      },
      {
        question: "What platforms does OmniAnalytix support?",
        answer: "OmniAnalytix integrates with a wide range of advertising, e-commerce, and CRM platforms:",
        details: [
          "Advertising: Google Ads, Meta (Facebook & Instagram) Ads",
          "Search & Shopping: Google Search Console, Google Merchant Center",
          "E-Commerce: Shopify, WooCommerce",
          "CRM: HubSpot, Salesforce",
          "Coming Soon: TikTok Ads, LinkedIn Ads, Amazon Ads",
        ],
      },
    ],
  },
  {
    title: "AI & Commands",
    icon: <MessageCircle className="w-3.5 h-3.5 text-violet-500" />,
    items: [
      {
        question: "How does the \u2318K Command Palette work?",
        answer: "Press \u2318K (or Ctrl+K on Windows) anywhere in the app to open the Command Palette. It contains pre-built prompts organized by category.",
        details: [
          "Diagnostics: Master Diagnostic Sweep, POAS Analysis, Budget Audit",
          "Reporting: Weekly PDF Report, QBR Deck, Client Brief",
          "Optimization: Find Capped Campaigns, Ad Copy Matrix, Audience Refresh",
          "You can also type any freeform question to the AI agent.",
        ],
      },
      {
        question: "What is the Approval Queue?",
        answer: "When the AI recommends an action that modifies your ad accounts (budget changes, bid adjustments, pausing campaigns), it creates a proposed task rather than executing immediately.",
        details: [
          "Admins and Managers can approve or reject proposed actions.",
          "Bulk approval is available for multiple low-risk changes.",
          "All actions are logged in the activity trail for compliance.",
        ],
      },
    ],
  },
  {
    title: "Analytics & Reporting",
    icon: <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />,
    items: [
      {
        question: "What does Live Triage analyse?",
        answer: "Live Triage continuously monitors your connected platforms for critical issues and surfaces the most urgent items first.",
        details: [
          "Out-of-stock products with active ad spend (margin leaks)",
          "Budget-constrained campaigns leaving conversions on the table",
          "Measurement gaps and tag firing anomalies",
          "Performance anomalies: sudden ROAS drops or spend spikes",
        ],
      },
      {
        question: "What is POAS and how is it different from ROAS?",
        answer: "ROAS (Return on Ad Spend) measures gross revenue per dollar spent. POAS (Profit on Ad Spend) factors in your actual margins.",
        details: [
          "POAS subtracts COGS, shipping, returns, and platform fees.",
          "A campaign can appear profitable by ROAS but unprofitable by POAS.",
          "OmniAnalytix uses your Shopify COGS data to compute POAS automatically.",
        ],
      },
      {
        question: "How does the weekly PDF report work?",
        answer: "Open the Command Palette (\u2318K) and select \"Generate Weekly PDF Report\" from the Reporting category.",
        details: [
          "The AI compiles cross-platform metrics into a narrative PDF.",
          "Includes trend analysis, performance summaries, and next-step recommendations.",
          "Reports can be shared via a unique URL or downloaded as PDF.",
        ],
      },
    ],
  },
  {
    title: "Security & Privacy",
    icon: <Shield className="w-3.5 h-3.5 text-amber-500" />,
    items: [
      {
        question: "How is my data secured?",
        answer: "OmniAnalytix uses industry-standard security practices to protect your data at every layer.",
        details: [
          "All data in transit is encrypted with TLS 1.3.",
          "OAuth tokens are stored encrypted and scoped to minimum required permissions.",
          "Your warehouse data is isolated per workspace with row-level security.",
          "We never share your data with third parties.",
        ],
      },
    ],
  },
];

function AccordionItem({ item, isOpen, onToggle }: { item: FaqItem; isOpen: boolean; onToggle: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(isOpen ? contentRef.current.scrollHeight : 0);
    }
  }, [isOpen]);

  return (
    <div
      className={cn(
        "rounded-2xl border transition-all duration-300 ease-out",
        isOpen
          ? "border-outline-variant/15 bg-white shadow-sm"
          : "ghost-border bg-white hover:border-outline-variant/15",
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left group"
      >
        <div className={cn(
          "w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-200",
          isOpen ? "bg-primary-container/10" : "bg-surface-container-low group-hover:bg-surface-container-highest/70",
        )}>
          <span className={cn(
            "material-symbols-outlined transition-colors duration-200",
            isOpen ? "text-primary-container" : "text-on-surface-variant",
          )} style={{ fontSize: 14 }}>
            {isOpen ? "help" : "help_outline"}
          </span>
        </div>
        <span className={cn(
          "flex-1 text-[13px] font-semibold leading-snug transition-colors duration-200",
          isOpen ? "text-on-surface" : "text-on-surface-variant group-hover:text-on-surface",
        )}>
          {item.question}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-outline-variant shrink-0 mt-0.5 transition-all duration-300 ease-out",
            isOpen && "rotate-180 text-primary-container",
          )}
        />
      </button>
      <div
        style={{ height }}
        className="overflow-hidden transition-[height] duration-300 ease-out"
      >
        <div ref={contentRef} className="px-4 pb-4 pl-12">
          <p className="text-[12.5px] text-on-surface-variant leading-relaxed mb-2">
            {item.answer}
          </p>
          {item.details && item.details.length > 0 && (
            <ul className="space-y-1.5">
              {item.details.map((detail, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-on-surface-variant leading-relaxed">
                  <span className="w-1 h-1 rounded-full bg-[#c8c5cb] shrink-0 mt-1.5" />
                  {detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function FaqDrawer({ isOpen, onClose }: FaqDrawerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setExpanded(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const toggleItem = (key: string) => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[90] bg-black/20 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          "fixed right-0 top-0 h-full w-full max-w-md z-[91] bg-surface shadow-2xl transition-transform duration-300 ease-out flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/15/70 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-primary-container/10 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary-container" />
            </div>
            <div>
              <h2 className="text-base font-bold text-on-surface tracking-tight">
                Help & FAQ
              </h2>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Quick answers to common questions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container-highest flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-on-surface-variant" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-5 space-y-6">
          {FAQ_CATEGORIES.map((category, catIdx) => (
            <div key={catIdx}>
              <div className="flex items-center gap-2 mb-3 px-1">
                {category.icon}
                <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
                  {category.title}
                </h3>
              </div>
              <div className="space-y-2">
                {category.items.map((item, itemIdx) => {
                  const key = `${catIdx}-${itemIdx}`;
                  return (
                    <AccordionItem
                      key={key}
                      item={item}
                      isOpen={expanded === key}
                      onToggle={() => toggleItem(key)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant/15/70 bg-white">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-on-surface-variant">
              Still need help?
            </p>
            <a
              href="mailto:support@omnianalytix.in"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-container hover:text-primary-m3 transition-colors"
            >
              <Link2 className="w-3 h-3" />
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
