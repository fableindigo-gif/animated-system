import React, { useState } from "react";
import { Plus, MessageSquare, Trash2, TerminalSquare, Plug, AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHasPermission } from "@/hooks/use-has-permission";
import type { GeminiConversation } from "@workspace/api-client-react";
import { useDeleteGeminiConversation, useListConnections } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListGeminiConversationsQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";

interface ChatSidebarProps {
  conversations: GeminiConversation[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}

export function ChatSidebar({ conversations, activeId, onSelect, onNew }: ChatSidebarProps) {
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteGeminiConversation();
  const [location] = useLocation();
  const { data: connections } = useListConnections();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const { permitted: canStartOperation } = useHasPermission("analyst");

  const activeConnectionsCount = connections?.length || 0;

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListGeminiConversationsQueryKey() });
        if (activeId === id) {
          onNew();
        }
        setPendingDeleteId(null);
      },
      onError: (err) => {
        setPendingDeleteId(null);
        console.error("[ChatSidebar] Failed to delete conversation:", err);
      },
    });
  };

  return (
    <div className="w-64 border-r border-border bg-sidebar flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <TerminalSquare className="w-6 h-6 text-primary" />
        <span className="font-bold tracking-tight text-sm uppercase">O.E.G.A.</span>
      </div>
      
      <div className="p-3">
        <div className="relative group/newop">
          <Button
            onClick={canStartOperation ? onNew : undefined}
            disabled={!canStartOperation}
            className={cn(
              "w-full justify-start gap-2 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border border-primary/20",
              !canStartOperation && "opacity-50 cursor-not-allowed",
            )}
            variant="outline"
            data-testid="button-new-operation"
            aria-disabled={!canStartOperation}
          >
            {canStartOperation ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            New Operation
          </Button>
          {!canStartOperation && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] whitespace-nowrap opacity-0 group-hover/newop:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
              Analyst access required
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="text-xs font-mono text-muted-foreground mb-2 px-2 uppercase tracking-wider">Log</div>
        {conversations.map((conv) => (
          <div key={conv.id}>
            {pendingDeleteId === conv.id ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 space-y-2 animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="text-[11px] text-rose-700 font-semibold">Delete this chat?</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(conv.id)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Confirm delete conversation ${conv.title || conv.id}`}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
                    data-testid={`button-confirm-delete-${conv.id}`}
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Yes"}
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(null)}
                    aria-label={`Cancel deleting conversation ${conv.title || conv.id}`}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 transition-colors"
                    data-testid={`button-cancel-delete-${conv.id}`}
                  >
                    No
                  </button>
                </div>
              </div>
            ) : (
              <div 
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
                  activeId === conv.id 
                    ? "bg-secondary text-secondary-foreground" 
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
                data-testid={`link-conversation-${conv.id}`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare className="w-4 h-4 shrink-0 opacity-50" />
                  <span className="truncate">{conv.title}</span>
                </div>
                <button 
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-all shrink-0"
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteId(conv.id); }}
                  data-testid={`button-delete-conversation-${conv.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Platform Status ─────────────────────────────────────────── */}
      <div className="px-3 py-2 border-t border-border">
        <div className="text-xs font-mono text-muted-foreground mb-2 px-2 uppercase tracking-wider">Platform Status</div>
        <div className="space-y-0.5">
          {(
            [
              {
                id: "google_ads",
                label: "Google Ads",
                active: !!connections?.find((c) => c.platform === "google_ads"),
              },
              {
                id: "ga4",
                label: "GA4",
                active: !!((connections?.find((c) => c.platform === "google_ads") as Record<string, unknown> | undefined)?.hasGa4PropertyId),
              },
              {
                id: "meta",
                label: "Meta Ads",
                active: !!connections?.find((c) => c.platform === "meta"),
              },
              {
                id: "shopify",
                label: "Shopify",
                active: !!connections?.find((c) => c.platform === "shopify"),
              },
              {
                id: "gmc",
                label: "Merchant Center",
                active: !!connections?.find((c) => c.platform === "gmc"),
              },
            ] as Array<{ id: string; label: string; active: boolean }>
          ).map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground">
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", p.active ? "bg-emerald-500" : "bg-muted-foreground/30")} />
              <span className={cn(p.active ? "text-foreground/70" : "text-muted-foreground/50")}>{p.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 border-t border-border">
        <Link href="/connections" className={cn(
          "flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
          location === "/connections"
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        )} data-testid="link-connections">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 shrink-0 opacity-70" />
            <span>Connections</span>
          </div>
          {activeConnectionsCount > 0 && (
            <span className="relative flex h-2 w-2" data-testid="badge-connections-active">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
