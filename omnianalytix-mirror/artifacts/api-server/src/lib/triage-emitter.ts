import { EventEmitter } from "events";

export interface TriageEvent {
  type: "alert" | "clear" | "heartbeat";
  eventId?: string;
  alert?: {
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    platform: string;
    action?: string;
    ts: string;
  };
  alertId?: string;
  ts: string;
}

const REPLAY_BUFFER_SIZE = 100;
const MAX_SSE_CONNECTIONS = 50;

interface BufferedEvent {
  eventId: string;
  event: TriageEvent;
}

const replayBuffer: BufferedEvent[] = [];
let eventCounter = 0;

const activeConnections = new Set<symbol>();

// Strongly-typed wrapper around Node's EventEmitter. We don't use overload
// signatures because Node's base EventEmitter has its own (incompatible)
// overload set; instead we expose typed helpers that defer to the base methods.
class TriageEmitter extends EventEmitter {
  emitTriage(data: TriageEvent): boolean {
    return this.emit("triage", data);
  }
  onTriage(listener: (data: TriageEvent) => void): this {
    return this.on("triage", listener as (...args: unknown[]) => void);
  }
  offTriage(listener: (data: TriageEvent) => void): this {
    return this.off("triage", listener as (...args: unknown[]) => void);
  }
}

export const triageEmitter = new TriageEmitter();
triageEmitter.setMaxListeners(MAX_SSE_CONNECTIONS + 10);

function nextEventId(): string {
  return String(++eventCounter);
}

function pushToReplayBuffer(event: TriageEvent): string {
  const eventId = nextEventId();
  event.eventId = eventId;
  replayBuffer.push({ eventId, event });
  if (replayBuffer.length > REPLAY_BUFFER_SIZE) {
    replayBuffer.shift();
  }
  return eventId;
}

export function getEventsSince(lastEventId: string): TriageEvent[] {
  const idx = replayBuffer.findIndex((b) => b.eventId === lastEventId);
  if (idx === -1) return [];
  return replayBuffer.slice(idx + 1).map((b) => b.event);
}

export function registerSseConnection(): symbol | null {
  if (activeConnections.size >= MAX_SSE_CONNECTIONS) {
    return null;
  }
  const token = Symbol("sse-conn");
  activeConnections.add(token);
  return token;
}

export function unregisterSseConnection(token: symbol): void {
  activeConnections.delete(token);
}

export function getActiveSseCount(): number {
  return activeConnections.size;
}

export function emitTriageAlert(alert: TriageEvent["alert"]): void {
  const event: TriageEvent = {
    type: "alert",
    alert,
    ts: new Date().toISOString(),
  };
  pushToReplayBuffer(event);
  triageEmitter.emit("triage", event);
}

export function emitTriageClear(alertId: string): void {
  const event: TriageEvent = {
    type: "clear",
    alertId,
    ts: new Date().toISOString(),
  };
  pushToReplayBuffer(event);
  triageEmitter.emit("triage", event);
}
