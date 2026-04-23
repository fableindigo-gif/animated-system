import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { SiGoogleads, SiMeta, SiShopify, SiGoogle } from "react-icons/si";
import { Search, BookOpen, Filter, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ResolutionEntry {
  id: number;
  platform: string;
  platformLabel: string;
  toolName: string;
  toolDisplayName: string;
  toolArgs: Record<string, unknown>;
  originalProblem: string;
  reasoning: string;
  displayDiff: Array<{ label: string; from: string; to: string }> | null;
  tags: string[];
  savedByName: string;
  createdAt: string;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  google_ads: <SiGoogleads className="w-4 h-4 text-[#4285F4]" />,
  meta: <SiMeta className="w-4 h-4 text-[#0081FB]" />,
  shopify: <SiShopify className="w-4 h-4 text-[#96bf48]" />,
  gmc: <SiGoogle className="w-4 h-4 text-[#EA4335]" />,
  gsc: <Search className="w-4 h-4 text-[#4285F4]" />,
};

const PLATFORM_BG: Record<string, string> = {
  google_ads: "bg-primary-container/10/60 border-primary-container/20",
  meta: "bg-primary-container/10/60 border-primary-container/20",
  shopify: "bg-emerald-50/60 border-green-100",
  gmc: "bg-error-container/60 border-red-100",
  gsc: "bg-sky-50/60 border-sky-100",
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function ResolutionCard({ entry }: { entry: ResolutionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const platformBg = PLATFORM_BG[entry.platform] || "bg-surface ghost-border";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border ghost-border shadow-sm overflow-hidden hover:shadow-md transition-shadow break-inside-avoid mb-4"
    >
      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("w-9 h-9 rounded-2xl border flex items-center justify-center shrink-0", platformBg)}>
            {PLATFORM_ICONS[entry.platform] || <BookOpen className="w-4 h-4 text-on-surface-variant" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-on-surface truncate">{entry.toolDisplayName}</h3>
            <p className="text-[10px] text-on-surface-variant mt-0.5">{entry.platformLabel} · by {entry.savedByName}</p>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-on-surface-variant shrink-0">
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(entry.createdAt)}
          </div>
        </div>

        <div className="bg-surface rounded-2xl p-3 mb-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Problem</p>
          <p className="text-xs text-on-surface-variant leading-relaxed">{entry.originalProblem}</p>
        </div>

        {entry.reasoning && (
          <div className="mb-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">AI Rationale</p>
            <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-3">{entry.reasoning}</p>
          </div>
        )}

        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {entry.tags.map((tag) => (
              <span key={tag} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-surface-container-low text-on-surface-variant border border-outline-variant/15">
                {tag}
              </span>
            ))}
          </div>
        )}

        {entry.displayDiff && entry.displayDiff.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] font-semibold text-primary-container hover:text-primary-m3 transition-colors"
          >
            {expanded ? "Hide Payload" : "View Payload"}
          </button>
        )}

        <AnimatePresence>
          {expanded && entry.displayDiff && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="bg-surface-container-high rounded-2xl p-3 mt-3 space-y-1.5">
                {entry.displayDiff.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-on-surface-variant">{d.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-rose-400 line-through">{d.from}</span>
                      <span className="text-on-surface-variant">→</span>
                      <span className="text-emerald-400">{d.to}</span>
                    </div>
                  </div>
                ))}
              </div>

              {entry.toolArgs && Object.keys(entry.toolArgs).length > 0 && (
                <div className="bg-surface-container-high rounded-2xl p-3 mt-2">
                  <p className="text-[9px] font-mono text-on-surface-variant mb-1">API Payload</p>
                  <pre className="text-[10px] font-mono text-emerald-400 whitespace-pre-wrap overflow-x-auto max-h-32">
                    {JSON.stringify(entry.toolArgs, null, 2)}
                  </pre>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default function ResolutionBase() {
  const [entries, setEntries] = useState<ResolutionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (platformFilter) params.set("platform", platformFilter);
        const res = await authFetch(`${BASE}/api/resolution-library?${params}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(Array.isArray(data) ? data : []);
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    const debounce = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(debounce);
  }, [search, platformFilter]);

  const STATIC_PLATFORMS = [
    { key: "google_ads", label: "Google Ads" },
    { key: "meta_ads", label: "Meta" },
    { key: "shopify", label: "Shopify" },
  ];

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="max-w-6xl mx-auto p-6 sm:p-12">

        <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 mb-8">
          <div className="space-y-1">
            <span className="text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
              Optimization Playbooks
            </span>
            <h1 className="text-[2.5rem] sm:text-[3.5rem] font-bold tracking-tighter leading-[1.1] text-on-surface">
              Optimization Playbooks
            </h1>
            <p className="text-on-surface-variant max-w-lg text-sm">
              A shared library of successful AI-executed fixes. Replicate winning strategies and scale what's working across client accounts.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2 bg-white border border-outline-variant/15 rounded-2xl px-3 py-2.5 shadow-sm min-w-[240px]">
              <Search className="w-4 h-4 text-on-surface-variant shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search optimization playbooks..."
                aria-label="Search optimization playbooks"
                className="bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-omni-primary/40 focus-visible:ring-offset-1 rounded-sm w-full placeholder:text-on-surface-variant"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          <button
            onClick={() => setPlatformFilter(null)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-semibold transition-all border shrink-0",
              !platformFilter
                ? "bg-primary-container text-white border-primary-container"
                : "bg-white text-on-surface-variant border-outline-variant/15 hover:border-[#c8c5cb]",
            )}
          >
            <Filter className="w-3 h-3" />
            All
          </button>
          {STATIC_PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatformFilter(p.key === platformFilter ? null : p.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-semibold transition-all border shrink-0",
                platformFilter === p.key
                  ? "bg-primary-container text-white border-primary-container"
                  : "bg-white text-on-surface-variant border-outline-variant/15 hover:border-[#c8c5cb]",
              )}
            >
              {PLATFORM_ICONS[p.key]}
              {p.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-52 rounded-2xl bg-white border ghost-border animate-pulse break-inside-avoid mb-4" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="bg-white rounded-2xl border ghost-border p-16 text-center shadow-sm">
            <span className="material-symbols-outlined text-5xl text-surface-container-highest mb-4 block">library_books</span>
            <p className="text-sm font-medium text-on-surface-variant">
              {search ? "No matching playbooks" : "No optimization playbooks yet"}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              {search
                ? "Try a different search term."
                : "When Account Directors approve tasks and save them, they'll appear here for the whole team."}
            </p>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
            {entries.map((entry) => (
              <ResolutionCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
