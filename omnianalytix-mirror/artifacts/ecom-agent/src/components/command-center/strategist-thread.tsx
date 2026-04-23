import { useEffect, useRef } from "react";
import { CheckCircle2, XCircle, Zap, Terminal, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export type ThreadEvent =
  | { type: "fetch"; platform: string; message: string; ts: number }
  | { type: "tool_start"; tools: string[]; ts: number }
  | { type: "tool_result"; name: string; success: boolean; message: string; ts: number }
  | { type: "approval_queued"; toolDisplayName: string; platform: string; ts: number }
  | { type: "approval_executed"; toolDisplayName: string; success: boolean; ts: number }
  | { type: "approval_rejected"; toolDisplayName: string; ts: number };

const PLATFORM_COLORS: Record<string, string> = {
  google_ads: "text-[#60a5fa]",
  meta: "text-[#1877F2]",
  shopify: "text-emerald-400",
  gmc: "text-rose-400",
  gsc: "text-emerald-400",
};

function formatTs(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toolToReadable(name: string) {
  return name.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
}

interface StrategistThreadProps {
  events: ThreadEvent[];
  isStreaming: boolean;
}

export function StrategistThread({ events, isStreaming }: StrategistThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="w-full h-full border-l border-border/50 bg-card/20 flex flex-col">
      <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-primary shrink-0" />
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Strategist</p>
          <h2 className="text-sm font-bold text-foreground">Thread</h2>
        </div>
        {isStreaming && (
          <span className="ml-auto flex h-2 w-2 rounded-full bg-primary animate-pulse" />
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5 font-mono text-[11px]">
          {events.length === 0 && (
            <div className="text-center py-8 text-muted-foreground/40">
              <Terminal className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p>Agent log will appear here</p>
            </div>
          )}
          {events.map((ev, i) => (
            <div key={i} className="flex gap-2 items-start group">
              <span className="text-muted-foreground/40 shrink-0 pt-0.5 text-[10px]">{formatTs(ev.ts)}</span>
              <div className="flex-1 min-w-0">
                {ev.type === "fetch" && (
                  <div className="flex items-center gap-1.5 text-cyan-400/80">
                    <Database className="w-3 h-3 shrink-0" />
                    <span className={cn("shrink-0", PLATFORM_COLORS[ev.platform] ?? "text-cyan-400")}>[{ev.platform}]</span>
                    <span className="text-muted-foreground truncate">{ev.message}</span>
                  </div>
                )}
                {ev.type === "tool_start" && (
                  <div className="space-y-0.5">
                    {ev.tools.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-1.5 text-amber-400/80">
                        <Zap className="w-3 h-3 shrink-0 animate-pulse" />
                        <span className="truncate">&gt; {toolToReadable(t)}</span>
                        <span className="text-muted-foreground/50 ml-auto shrink-0">…</span>
                      </div>
                    ))}
                  </div>
                )}
                {ev.type === "tool_result" && (
                  <div className={cn(
                    "flex items-start gap-1.5",
                    ev.success ? "text-emerald-400/80" : "text-rose-400/80",
                  )}>
                    {ev.success
                      ? <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                      : <XCircle className="w-3 h-3 shrink-0 mt-0.5" />}
                    <span className="break-words">{ev.message.slice(0, 120)}{ev.message.length > 120 ? "…" : ""}</span>
                  </div>
                )}
                {ev.type === "approval_queued" && (
                  <div className="flex items-center gap-1.5 text-orange-400/90">
                    <span className="text-orange-400">⏸</span>
                    <span><span className={PLATFORM_COLORS[ev.platform] ?? ""}>[{ev.platform}]</span> {ev.toolDisplayName} — awaiting approval</span>
                  </div>
                )}
                {ev.type === "approval_executed" && (
                  <div className={cn("flex items-center gap-1.5", ev.success ? "text-emerald-400" : "text-rose-400")}>
                    {ev.success ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
                    <span>{ev.toolDisplayName} — {ev.success ? "executed" : "execution failed"}</span>
                  </div>
                )}
                {ev.type === "approval_rejected" && (
                  <div className="flex items-center gap-1.5 text-muted-foreground/60">
                    <XCircle className="w-3 h-3 shrink-0" />
                    <span>{ev.toolDisplayName} — rejected</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div className="flex items-center gap-2 text-primary/60">
              <span className="animate-pulse">▊</span>
              <span>Processing…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
