import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

const SIDEBAR_SECTIONS = [
  {
    title: "Getting Started",
    icon: "rocket_launch",
    items: [
      { label: "Introduction", slug: "introduction" },
      { label: "Best Practices", slug: "best-practices" },
      { label: "Keyboard Shortcuts", slug: "keyboard-shortcuts" },
    ],
  },
  {
    title: "Analyze & Build",
    icon: "query_stats",
    items: [
      { label: "Workbook Basics", slug: "workbook-basics" },
      { label: "Data Input", slug: "data-input" },
      { label: "Custom Metrics", slug: "custom-metrics" },
    ],
  },
  {
    title: "Visualize & Present",
    icon: "dashboard",
    items: [
      { label: "Dashboards", slug: "dashboards" },
      { label: "Looker Embedded Analytics", slug: "looker-analytics" },
    ],
  },
  {
    title: "Deliver Content",
    icon: "send",
    items: [
      { label: "Webhooks", slug: "webhooks" },
      { label: "Google Sheets Exports", slug: "sheets-exports" },
      { label: "Slack Alerts", slug: "slack-alerts" },
    ],
  },
  {
    title: "Developer APIs",
    icon: "code",
    items: [
      { label: "REST APIs", slug: "rest-apis" },
      { label: "Webhook Payloads", slug: "webhook-payloads" },
    ],
  },
];

const ONBOARDING_CARDS = [
  {
    title: "Agency Principal",
    subtitle: "Onboarding",
    description: "Manage users, billing, and multi-tenant workspaces.",
    icon: "admin_panel_settings",
    gradient: "from-[#2563EB] to-[#1e40af]",
    iconBg: "bg-[#2563EB]/10",
    iconColor: "text-[#2563EB]",
  },
  {
    title: "Media Buyer",
    subtitle: "Onboarding",
    description: "Get started with the AI Command Center and Live Triage.",
    icon: "campaign",
    gradient: "from-[#7c3aed] to-[#5b21b6]",
    iconBg: "bg-[#7c3aed]/10",
    iconColor: "text-[#7c3aed]",
  },
  {
    title: "Data & IT Admin",
    subtitle: "Onboarding",
    description: "Set up Auto-ETL, CRM mapping, and API integrations.",
    icon: "engineering",
    gradient: "from-[#0891b2] to-[#0e7490]",
    iconBg: "bg-[#0891b2]/10",
    iconColor: "text-[#0891b2]",
  },
];

const INSPIRATION_CARDS = [
  {
    title: "Changelog",
    description: "Keep up with the latest product releases.",
    icon: "new_releases",
    color: "text-[#2563EB]",
    bg: "bg-[#2563EB]/5",
    border: "border-[#2563EB]/10",
  },
  {
    title: "Example Showcase",
    description: "Get inspired with dashboards and automated workflows.",
    icon: "auto_awesome",
    color: "text-[#7c3aed]",
    bg: "bg-[#7c3aed]/5",
    border: "border-[#7c3aed]/10",
  },
  {
    title: "Community",
    description: "Search for FAQs and analytical patterns.",
    icon: "forum",
    color: "text-[#0891b2]",
    bg: "bg-[#0891b2]/5",
    border: "border-[#0891b2]/10",
  },
];

export default function DocsHub() {
  const [, navigate] = useLocation();
  const [activeSlug, setActiveSlug] = useState("introduction");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  function handleSearchClick() {
    window.dispatchEvent(new CustomEvent("omni:open-command-palette"));
  }

  return (
    <div className="min-h-screen bg-[#f9f9fe]">
      <div className="flex">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            "fixed top-16 left-0 lg:left-[260px] bottom-0 w-[260px] bg-white border-r border-[#e8e8ed] z-50 lg:z-30 overflow-y-auto transition-transform duration-300",
            "scrollbar-thin scrollbar-thumb-slate-200",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
        >
          <div className="p-5">
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-[#2563EB] text-xl">menu_book</span>
              <h2 className="font-bold text-sm text-on-surface tracking-tight">Documentation</h2>
            </div>

            {SIDEBAR_SECTIONS.map((section) => (
              <div key={section.title} className="mb-5">
                <div className="flex items-center gap-2 px-2 mb-2">
                  <span className="material-symbols-outlined text-on-surface-variant/50 text-[15px]">{section.icon}</span>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/60">{section.title}</p>
                </div>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <button
                      key={item.slug}
                      onClick={() => { setActiveSlug(item.slug); setSidebarOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium transition-all",
                        activeSlug === item.slug
                          ? "bg-[#2563EB]/8 text-[#2563EB] font-semibold"
                          : "text-on-surface-variant hover:bg-surface-container-low/60 hover:text-on-surface"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 lg:ml-[260px] min-h-screen">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden fixed bottom-20 right-4 z-40 w-12 h-12 rounded-2xl bg-[#2563EB] text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-xl">menu_book</span>
          </button>

          <section className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#2563EB]/[0.03] via-transparent to-[#7c3aed]/[0.03]" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#2563EB]/[0.04] blur-[120px] pointer-events-none" />

            <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-14 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#2563EB]/8 text-[#2563EB] text-xs font-semibold mb-6 border border-[#2563EB]/10">
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                AI-Powered Knowledge Base
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold text-on-surface tracking-tight leading-tight mb-4">
                Welcome to the<br />
                <span className="text-[#2563EB]">OmniAnalytix Docs!</span>
              </h1>

              <p className="text-sm sm:text-base text-on-surface-variant leading-relaxed max-w-xl mx-auto mb-10">
                The business intelligence platform that combines the consistency of a shared data model with the freedom of SQL and AI execution.
              </p>

              <div
                onClick={handleSearchClick}
                className={cn(
                  "max-w-lg mx-auto flex items-center gap-3 px-5 py-4 rounded-2xl bg-white border-2 cursor-pointer transition-all shadow-sm hover:shadow-md",
                  searchFocused ? "border-[#2563EB] shadow-[#2563EB]/10" : "border-[#e8e8ed] hover:border-[#2563EB]/30"
                )}
                onMouseEnter={() => setSearchFocused(true)}
                onMouseLeave={() => setSearchFocused(false)}
              >
                <span className={cn("material-symbols-outlined text-xl transition-colors", searchFocused ? "text-[#2563EB]" : "text-on-surface-variant/40")}>
                  search
                </span>
                <span className="flex-1 text-left text-on-surface-variant/50 text-sm">Search or Ask AI...</span>
                <kbd className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f3f3f8] border border-[#e2e2e7] text-[10px] font-bold text-on-surface-variant/60 tracking-wider">
                  Ctrl K
                </kbd>
              </div>
            </div>
          </section>

          <section className="max-w-4xl mx-auto px-6 pb-14">
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-on-surface-variant/50 text-lg">person</span>
              <h2 className="text-sm font-bold text-on-surface tracking-tight">Quick Start by Role</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {ONBOARDING_CARDS.map((card) => (
                <button
                  key={card.title}
                  className="group text-left bg-white rounded-3xl border border-[#e8e8ed] p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                >
                  <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center mb-4", card.iconBg)}>
                    <span className={cn("material-symbols-outlined text-xl", card.iconColor)}>{card.icon}</span>
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant/50 mb-1">{card.subtitle}</p>
                  <h3 className="text-base font-bold text-on-surface mb-2 group-hover:text-[#2563EB] transition-colors">{card.title}</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{card.description}</p>
                  <div className="flex items-center gap-1 mt-4 text-[#2563EB] text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    Start guide
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="max-w-4xl mx-auto px-6 pb-14">
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-on-surface-variant/50 text-lg">category</span>
              <h2 className="text-sm font-bold text-on-surface tracking-tight">Browse by Topic</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {SIDEBAR_SECTIONS.map((section) => (
                <div
                  key={section.title}
                  className="bg-white rounded-2xl border border-[#e8e8ed] p-5 hover:shadow-md hover:border-[#2563EB]/15 transition-all group cursor-pointer"
                  onClick={() => { setActiveSlug(section.items[0].slug); }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-[#2563EB]/8 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[#2563EB] text-lg">{section.icon}</span>
                    </div>
                    <h3 className="text-sm font-bold text-on-surface group-hover:text-[#2563EB] transition-colors">{section.title}</h3>
                  </div>
                  <ul className="space-y-1.5">
                    {section.items.map((item) => (
                      <li key={item.slug} className="flex items-center gap-2 text-xs text-on-surface-variant">
                        <span className="w-1 h-1 rounded-full bg-on-surface-variant/30" />
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="max-w-4xl mx-auto px-6 pb-20">
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-on-surface-variant/50 text-lg">lightbulb</span>
              <h2 className="text-sm font-bold text-on-surface tracking-tight">Inspiration and releases</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {INSPIRATION_CARDS.map((card) => (
                <div
                  key={card.title}
                  className={cn(
                    "rounded-2xl border p-5 hover:shadow-md transition-all group cursor-pointer",
                    card.bg, card.border
                  )}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className={cn("material-symbols-outlined text-xl", card.color)}>{card.icon}</span>
                    <h3 className={cn("text-sm font-bold", card.color)}>{card.title}</h3>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{card.description}</p>
                  <div className={cn("flex items-center gap-1 mt-4 text-xs font-semibold opacity-60 group-hover:opacity-100 transition-opacity", card.color)}>
                    Explore
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
