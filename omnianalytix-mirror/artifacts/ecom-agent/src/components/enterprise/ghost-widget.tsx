import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface GhostWidgetProps {
  platformName: string;
  platformIcon: React.ReactNode;
  accentColor: string;
  metrics: Array<{ label: string }>;
  onConnect: () => void;
}

export function GhostWidget({ platformName, platformIcon, accentColor, metrics, onConnect }: GhostWidgetProps) {
  return (
    <div className="relative rounded-2xl border border-outline-variant/15/60 bg-surface-container-low/60 overflow-hidden group">
      <div className="pointer-events-none select-none p-4 space-y-3 opacity-50">
        <div className="flex items-center gap-2">
          {platformIcon}
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">{platformName}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-2xl bg-white border ghost-border px-3 py-2.5">
              <p className="text-[8px] font-mono text-on-surface-variant uppercase tracking-wider">{m.label}</p>
              <div className="h-5 w-16 bg-surface-container-highest rounded animate-pulse mt-1.5" />
            </div>
          ))}
        </div>

        <div className="h-12 rounded-2xl bg-surface-container-highest/60 animate-pulse" />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 bg-white border border-outline-variant/15 shadow-sm">
          <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 22 }}>link_off</span>
        </div>
        <p className="text-xs font-semibold text-on-surface mb-1">No Data Available</p>
        <p className="text-[10px] text-on-surface-variant mb-3 font-mono">Connect {platformName} to see live metrics</p>
        <button
          onClick={onConnect}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-2xl text-[11px] font-semibold font-[system-ui]",
            "border",
            "hover:brightness-110 active:scale-[0.97] transition-all",
          )}
          style={{
            background: `${accentColor}10`,
            borderColor: `${accentColor}30`,
            color: accentColor,
          }}
        >
          Connect {platformName}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
