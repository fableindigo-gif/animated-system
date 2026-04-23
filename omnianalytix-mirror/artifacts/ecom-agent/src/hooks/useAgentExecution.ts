import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useDashboardStore } from "@/store/dashboardStore";
import { authFetch, getActiveWorkspaceId, getActiveOrgId } from "@/lib/auth-fetch";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export interface AgentExecutionState {
  agentName: string | null;
  toolName: string | null;
  status: "idle" | "analyzing" | "complete" | "error";
  message: string;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  setAnalyzing: (agentName: string, toolName: string, message: string) => void;
  setComplete: (message: string) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useAgentExecutionStore = create<AgentExecutionState>((set) => ({
  agentName: null,
  toolName: null,
  status: "idle",
  message: "",
  startedAtMs: null,
  finishedAtMs: null,
  setAnalyzing: (agentName, toolName, message) => set({
    agentName, toolName, status: "analyzing", message,
    startedAtMs: Date.now(), finishedAtMs: null,
  }),
  setComplete: (message) => set({
    status: "complete", message, finishedAtMs: Date.now(),
  }),
  setError: (message) => set({
    status: "error", message, finishedAtMs: Date.now(),
  }),
  reset: () => set({
    agentName: null, toolName: null, status: "idle",
    message: "", startedAtMs: null, finishedAtMs: null,
  }),
}));

async function callMcpTool(toolName: string, args: Record<string, unknown> = {}) {
  const res = await authFetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${toolName}_${Date.now()}`,
      method: "invoke_tool",
      params: {
        tool_name: toolName,
        workspace_id: getActiveWorkspaceId() ?? "ws_default",
        org_id: getActiveOrgId() ?? "org_default",
        args,
      },
    }),
  });
  return res.json();
}

/**
 * Watches `syncState`. When the warehouse transitions FROM "STALE_DATA"
 * back to "OPERATIONAL_POPULATED" (i.e. a fresh sync just landed), this
 * triggers the Gap Finder agent to re-verify inventory velocity and
 * surfaces an "Analyzing…" status in the AI Logs panel.
 *
 * Also fires once on mount if syncState === "STALE_DATA" so the agent
 * status is visible while the user waits for the fresh data.
 */
export function useAgentExecution() {
  const syncState = useDashboardStore((s) => s.syncState);
  const exec = useAgentExecutionStore();
  const prevState = useRef(syncState);

  useEffect(() => {
    const previous = prevState.current;
    prevState.current = syncState;

    // Surface a holding status while data is stale.
    if (syncState === "STALE_DATA" && exec.status === "idle") {
      exec.setAnalyzing(
        "Gap Finder",
        "get_inventory_velocity",
        "Gap Finder is Analyzing… (waiting for fresh warehouse data)",
      );
      return;
    }

    // The transition we actually care about: stale → fresh.
    const cameBackOnline = previous === "STALE_DATA" && syncState === "OPERATIONAL_POPULATED";
    if (!cameBackOnline) return;

    let cancelled = false;
    (async () => {
      exec.setAnalyzing(
        "Gap Finder",
        "get_inventory_velocity",
        "Gap Finder is Analyzing… re-verifying inventory velocity on fresh data",
      );
      try {
        const result = await callMcpTool("get_inventory_velocity", { limit: 50 });
        if (cancelled) return;
        const skuCount = result?.result?.sku_count ?? 0;
        const stale = (result?.result?.skus ?? []).filter(
          (s: { velocity_class: string }) => s.velocity_class === "STALE",
        ).length;
        exec.setComplete(
          `Gap Finder finished — analyzed ${skuCount} SKUs, ${stale} stale-velocity flagged`,
        );
      } catch (e) {
        if (cancelled) return;
        exec.setError(`Gap Finder failed: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    })();

    return () => { cancelled = true; };
  }, [syncState, exec]);
}
