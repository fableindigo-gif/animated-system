import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch, authPost } from "@/lib/auth-fetch";
import { toast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

type Severity = "critical" | "warning" | "info";

export interface TriageAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  platform: string;
  action?: string;
  type?: string;
  ts: string;
}

export type TriageStreamStatus = "live" | "reconnecting" | "offline";

interface TriageStreamState {
  alerts: TriageAlert[];
  connected: boolean;
  lastEvent: number | null;
  status: TriageStreamStatus;
}

const OFFLINE_AFTER_RETRIES = 3;

const MAX_ALERTS = 200;
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function capAlerts(alerts: TriageAlert[]): TriageAlert[] {
  if (alerts.length <= MAX_ALERTS) return alerts;
  const sorted = [...alerts].sort((a, b) => {
    const rA = SEVERITY_RANK[a.severity] ?? 9;
    const rB = SEVERITY_RANK[b.severity] ?? 9;
    if (rA !== rB) return rA - rB;
    return new Date(b.ts).getTime() - new Date(a.ts).getTime();
  });
  return sorted.slice(0, MAX_ALERTS);
}

async function obtainSseTicket(goal: string): Promise<string | null> {
  try {
    const resp = await authPost("/api/live-triage/ticket", { goal });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ticket ?? null;
  } catch (err) {
    console.error("[LiveTriage] Failed to obtain SSE ticket:", err);
    return null;
  }
}

export function useLiveTriageStream(goal: string) {
  const [state, setState] = useState<TriageStreamState>({
    alerts: [],
    connected: false,
    lastEvent: null,
    status: "reconnecting",
  });
  const [initialLoaded, setInitialLoaded] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const parseFailureNotified = useRef<Record<string, boolean>>({});
  const retryCountRef = useRef(0);
  const disconnectToastShown = useRef(false);

  const connect = useCallback(async () => {
    if (esRef.current) {
      esRef.current.close();
    }

    const ticket = await obtainSseTicket(goalRef.current);
    if (!ticket) {
      retryCountRef.current += 1;
      const nextStatus: TriageStreamStatus =
        retryCountRef.current >= OFFLINE_AFTER_RETRIES ? "offline" : "reconnecting";
      setState((s) => ({ ...s, connected: false, status: nextStatus }));
      reconnectTimer.current = setTimeout(() => connect(), 5000);
      return;
    }

    const url = `${API_BASE}/api/live-triage/stream?ticket=${encodeURIComponent(ticket)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      retryCountRef.current = 0;
      disconnectToastShown.current = false;
      setState((s) => ({ ...s, connected: true, status: "live" }));
    };

    const reportParseFailure = (eventName: string, err: unknown) => {
      console.error(`[LiveTriage] Failed to parse ${eventName} event:`, err);
      // Dedupe to once per event type per connection so a malformed stream
      // can't flood the UI with toasts.
      if (parseFailureNotified.current[eventName]) return;
      parseFailureNotified.current[eventName] = true;
      toast({
        title: "Live alerts data error",
        description: `We received a malformed ${eventName} update from the server. Some alerts may be out of date — try refreshing.`,
        variant: "destructive",
      });
    };

    es.addEventListener("initial", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.alerts) {
          setState((s) => ({
            ...s,
            alerts: capAlerts(data.alerts),
            lastEvent: Date.now(),
          }));
          setInitialLoaded(true);
        }
      } catch (err) { reportParseFailure("initial", err); }
    });

    es.addEventListener("alert", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.alert) {
          setState((s) => {
            const existing = s.alerts.findIndex((a) => a.id === data.alert.id);
            const next = [...s.alerts];
            if (existing >= 0) {
              next[existing] = data.alert;
            } else {
              next.unshift(data.alert);
            }
            const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
            next.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
            return { ...s, alerts: capAlerts(next), lastEvent: Date.now() };
          });
        }
      } catch (err) { reportParseFailure("alert", err); }
    });

    es.addEventListener("clear", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.alertId) {
          setState((s) => ({
            ...s,
            alerts: s.alerts.filter((a) => a.id !== data.alertId),
            lastEvent: Date.now(),
          }));
        }
      } catch (err) { reportParseFailure("clear", err); }
    });

    es.addEventListener("heartbeat", () => {
      setState((s) => ({ ...s, lastEvent: Date.now() }));
    });

    es.onerror = () => {
      const wasConnected = esRef.current === es;
      es.close();
      retryCountRef.current += 1;
      const nextStatus: TriageStreamStatus =
        retryCountRef.current >= OFFLINE_AFTER_RETRIES ? "offline" : "reconnecting";
      setState((s) => {
        if (s.connected && wasConnected && !disconnectToastShown.current) {
          disconnectToastShown.current = true;
          toast({
            title: "Live alerts disconnected",
            description: "Reconnecting in a few seconds…",
            variant: "destructive",
          });
        }
        return { ...s, connected: false, status: nextStatus };
      });
      reconnectTimer.current = setTimeout(() => connect(), 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) esRef.current.close();
    };
  }, [connect]);

  useEffect(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    connect();
  }, [goal]);

  const manualRefresh = useCallback(async () => {
    try {
      const resp = await authFetch(`/api/live-triage?goal=${goalRef.current}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setState((s) => ({
        ...s,
        alerts: capAlerts(data.alerts ?? []),
        lastEvent: Date.now(),
      }));
    } catch (err) { console.error("[LiveTriage] Manual refresh failed:", err); }
  }, []);

  return {
    alerts: state.alerts,
    connected: state.connected,
    status: state.status,
    initialLoaded,
    lastEvent: state.lastEvent,
    manualRefresh,
  };
}
