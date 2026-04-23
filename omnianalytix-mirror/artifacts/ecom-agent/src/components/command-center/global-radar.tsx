import { Link } from "wouter";
import { Settings, Plus, ChevronRight, FileDown, Presentation, Terminal } from "lucide-react";
import { SiGoogleads, SiMeta, SiShopify, SiGoogle, SiYoutube } from "react-icons/si";
import { Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GeminiConversation, PlatformConnection } from "@workspace/api-client-react";

interface GlobalRadarProps {
  connections: PlatformConnection[];
  conversations: GeminiConversation[];
  activeConvId: number | null;
  onSelectConv: (id: number | null) => void;
  onNewConv: () => void;
  onDownloadWeeklyPDF?: () => void;
  onDownloadQBR?: () => void;
}

const PLATFORM_META = [
  { id: "google_ads",  label: "Google Ads",        Icon: SiGoogleads, color: "text-[#60a5fa]",    metric: "Spend" },
  { id: "meta",        label: "Meta Ads",           Icon: SiMeta,      color: "text-[#1877F2]",   metric: "Spend" },
  { id: "shopify",     label: "Shopify",            Icon: SiShopify,   color: "text-emerald-400",   metric: "Rev" },
  { id: "gmc",         label: "Merchant Center",    Icon: SiGoogle,    color: "text-rose-400",     metric: null },
  { id: "gsc",         label: "Search Console",     Icon: Search,      color: "text-emerald-400", metric: null },
  { id: "youtube",     label: "YouTube / Data",     Icon: SiYoutube,   color: "text-error-m3",     metric: null },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pb-1.5 mb-2 border-b border-outline-variant/15">
      <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">{children}</p>
    </div>
  );
}

export function GlobalRadar({ connections, conversations, activeConvId, onSelectConv, onNewConv, onDownloadWeeklyPDF, onDownloadQBR }: GlobalRadarProps) {
  const connectedSet = new Set(connections.map((c) => c.platform));

  return (
    <div className="w-full h-full border-r border-border/50 bg-card/30 flex flex-col">

      {/* Header / Logo */}
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold tracking-tight text-on-surface">
            <span className="text-accent-blue">Omni</span>Analytix
          </span>
        </div>
        <Link href="/connections">
          <button
            className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Manage Connections"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </Link>
      </div>

      {/* Platform Status */}
      <div className="px-3 py-3 border-b border-border/50 shrink-0">
        <SectionLabel>Platform Status</SectionLabel>
        <div className="space-y-0.5">
          {PLATFORM_META.map(({ id, label, Icon, color, metric }) => {
            const isConnected = connectedSet.has(id);
            return (
              <div
                key={id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                  isConnected ? "bg-secondary/20" : "opacity-40",
                )}
              >
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                <span className={cn(
                  "flex-1 font-medium truncate text-[11px]",
                  isConnected ? "text-foreground" : "text-muted-foreground",
                )}>
                  {label}
                </span>
                {isConnected && metric ? (
                  <span className="text-[10px] font-mono text-on-surface-variant shrink-0">—</span>
                ) : null}
                <span className={cn(
                  "flex h-1.5 w-1.5 rounded-full shrink-0",
                  isConnected ? "bg-emerald-600" : "bg-outline",
                )} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Execution Logs */}
      <div className="flex-1 flex flex-col min-h-0 px-3 py-3">
        <SectionLabel>Execution Logs</SectionLabel>

        {/* New Execution Log button */}
        <button
          onClick={onNewConv}
          className="w-full flex items-center gap-2 px-2 py-2 mb-2 rounded text-left text-xs text-on-surface-variant hover:text-on-surface border border-dashed border-outline-variant/30 hover:border-accent-blue/30 hover:bg-accent-blue/5 transition-all duration-150 shrink-0"
        >
          <Plus className="w-3 h-3 shrink-0 text-accent-blue" />
          <span className="font-mono">New Execution Log</span>
        </button>

        <ScrollArea className="flex-1">
          <div className="space-y-0.5 pr-1">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4 opacity-60">No logs yet</p>
            )}
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConv(conv.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors group",
                  activeConvId === conv.id
                    ? "bg-primary/15 text-foreground border border-primary/20"
                    : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
              >
                <Terminal className="w-3 h-3 shrink-0 opacity-60" />
                <span className="text-xs truncate flex-1 font-mono">{conv.title}</span>
                {activeConvId === conv.id && <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Reports Section */}
      <div className="px-3 py-3 border-t border-border/50 shrink-0">
        <SectionLabel>Reports</SectionLabel>
        <div className="space-y-1">
          {onDownloadWeeklyPDF && (
            <button
              onClick={onDownloadWeeklyPDF}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
              title="Download Weekly PDF Report"
            >
              <FileDown className="w-3 h-3 shrink-0 text-teal-400" />
              <span className="flex-1">Weekly PDF Report</span>
            </button>
          )}
          {onDownloadQBR && (
            <button
              onClick={onDownloadQBR}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
              title="Generate QBR Presentation"
            >
              <Presentation className="w-3 h-3 shrink-0 text-purple-400" />
              <span className="flex-1">QBR Deck (.pptx)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
