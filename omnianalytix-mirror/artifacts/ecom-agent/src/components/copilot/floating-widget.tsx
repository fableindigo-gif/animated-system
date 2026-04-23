import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useLocation } from "wouter";
import { X, Send, Loader2, Minimize2, Trash2, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { authPost } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { CopilotMessage, type SuggestedAction, type ToolCall } from "./message";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ChatMode = "copilot" | "agent";

interface ChatEntry {
  role:              "user" | "assistant";
  content:           string;
  suggested_actions?: SuggestedAction[];
  toolCalls?:        ToolCall[];
  isGreeting?:       boolean;
}

interface VertexHistoryPart { role: "user" | "model"; parts: { text: string }[] }

// ─── Constants ─────────────────────────────────────────────────────────────────

const FONT = "'Inter', 'Manrope', system-ui, sans-serif";

const HEADER_BG = "linear-gradient(160deg, #0d1117 0%, #141e33 100%)";

const FAB_BG    = "linear-gradient(135deg, #004ac6 0%, #1a73e8 100%)";

const DRAWER_W  = "clamp(340px, 30vw, 420px)";

const GREETING_PROMPT = `\
Analyze the current screen context and produce a helpful proactive greeting. \
Surface any obvious anomalies or quick-win opportunities from the visible KPIs. \
Suggest 1–2 concrete actions. Keep the greeting under 60 words.`;

// ─── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY      = "omni_copilot_state_v1";
const MAX_STORED_MSGS  = 50;

interface PersistedState {
  mode:            ChatMode;
  copilotMessages: ChatEntry[];
  agentMessages:   ChatEntry[];
  agentSessionId:  string | null;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      mode:            parsed.mode === "agent" ? "agent" : "copilot",
      copilotMessages: Array.isArray(parsed.copilotMessages) ? parsed.copilotMessages.slice(-MAX_STORED_MSGS) : [],
      agentMessages:   Array.isArray(parsed.agentMessages)   ? parsed.agentMessages.slice(-MAX_STORED_MSGS)   : [],
      agentSessionId:  typeof parsed.agentSessionId === "string" ? parsed.agentSessionId : null,
    };
  } catch {
    return null;
  }
}

function savePersistedState(state: PersistedState): void {
  try {
    const trimmed: PersistedState = {
      mode:            state.mode,
      copilotMessages: state.copilotMessages.slice(-MAX_STORED_MSGS),
      agentMessages:   state.agentMessages.slice(-MAX_STORED_MSGS),
      agentSessionId:  state.agentSessionId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota / unavailable — silent */ }
}

// ─── Context harvester ─────────────────────────────────────────────────────────

function harvestVisibleMetrics(): Record<string, string | number> {
  const metrics: Record<string, string | number> = {};
  try {
    document.querySelectorAll("[data-metric-key]").forEach((el) => {
      const key   = el.getAttribute("data-metric-key");
      const value = el.getAttribute("data-metric-value") ?? el.textContent?.trim() ?? "";
      if (key && value) metrics[key] = value;
    });
    document.querySelectorAll("[data-kpi-card]").forEach((card) => {
      const label = card.querySelector("[data-kpi-label]")?.textContent?.trim();
      const val   = card.querySelector("[data-kpi-value]")?.textContent?.trim();
      if (label && val) metrics[label] = val;
    });
  } catch { /* silent */ }
  return metrics;
}

// ─── Typing dots ───────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-start gap-2">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: FAB_BG }}
      >
        <span
          className="material-symbols-outlined text-white"
          style={{ fontSize: "12px", fontVariationSettings: "'FILL' 1" }}
        >
          smart_toy
        </span>
      </div>
      <div
        className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm"
        style={{ background: "#eef2ff" }}
      >
        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{ background: "#4f7ef8", animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Mode toggle ───────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: "rgba(255,255,255,0.08)" }}
    >
      {(["copilot", "agent"] as ChatMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all"
          style={{
            background: mode === m ? "rgba(255,255,255,0.18)" : "transparent",
            color:      mode === m ? "#fff"                    : "rgba(255,255,255,0.45)",
          }}
        >
          {m === "copilot" ? "Copilot" : "Agent"}
        </button>
      ))}
    </div>
  );
}

// ─── Drawer spring config ──────────────────────────────────────────────────────

const SPRING = { type: "spring" as const, stiffness: 340, damping: 38 };

// ─── Main widget ──────────────────────────────────────────────────────────────

export function OmniCopilotWidget() {
  const [location]                         = useLocation();
  const { activeWorkspace }                = useWorkspace();
  const initialState                       = useRef<PersistedState | null>(loadPersistedState()).current;
  const [isOpen, setIsOpen]               = useState(false);
  const [isMinimised, setIsMinimised]     = useState(false);
  const [mode, setMode]                   = useState<ChatMode>(initialState?.mode ?? "copilot");
  const [copilotMessages, setCopilotMessages] = useState<ChatEntry[]>(initialState?.copilotMessages ?? []);
  const [agentMessages, setAgentMessages]     = useState<ChatEntry[]>(initialState?.agentMessages   ?? []);
  const [input, setInput]                 = useState("");
  const [isSending, setIsSending]         = useState(false);
  const [isGreetingLoading, setIsGreetingLoading] = useState(false);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(initialState?.agentSessionId ?? null);
  const hasGreeted                         = useRef((initialState?.copilotMessages?.length ?? 0) > 0);

  const messages = mode === "agent" ? agentMessages : copilotMessages;
  const bottomRef                          = useRef<HTMLDivElement>(null);
  const inputRef                           = useRef<HTMLTextAreaElement>(null);

  const firstName = (localStorage.getItem("omni_user_name") || "").split(" ")[0] || null;

  // ── Scroll to bottom on new messages ─────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Persist chat state across page refreshes ─────────────────────────────
  useEffect(() => {
    savePersistedState({ mode, copilotMessages, agentMessages, agentSessionId });
  }, [mode, copilotMessages, agentMessages, agentSessionId]);

  // ── Focus input when drawer opens ─────────────────────────────────────────
  useEffect(() => {
    if (isOpen && !isMinimised) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen, isMinimised]);

  // ── ⌘K / event-bus: listen for omni:open-copilot ─────────────────────────
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
      setIsMinimised(false);
    };
    window.addEventListener("omni:open-copilot", handler);
    return () => window.removeEventListener("omni:open-copilot", handler);
  }, []);

  // ── Build vertex history ───────────────────────────────────────────────────
  function buildHistory(msgs: ChatEntry[]): VertexHistoryPart[] {
    return msgs
      .filter((m) => !m.isGreeting)
      .map((m) => ({
        role:  m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));
  }

  // ── Send via OmniCopilot (Vertex AI) ──────────────────────────────────────
  const sendCopilotMessage = useCallback(
    async (text: string, isProactive = false) => {
      const context = {
        currentRoute:    location,
        activeWorkspace: activeWorkspace
          ? { id: activeWorkspace.id, name: activeWorkspace.clientName }
          : null,
        visibleMetrics:  harvestVisibleMetrics(),
      };

      if (!isProactive) {
        setCopilotMessages((prev) => [...prev, { role: "user", content: text }]);
      }

      const historySnapshot = buildHistory(copilotMessages);
      if (isProactive) setIsGreetingLoading(true);
      else             setIsSending(true);

      try {
        const res = await authPost("/api/copilot/chat", {
          message:   isProactive ? GREETING_PROMPT : text,
          context,
          history:   historySnapshot,
          proactive: isProactive,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          message:           string;
          suggested_actions: SuggestedAction[];
        };

        setCopilotMessages((prev) => [
          ...prev,
          {
            role:              "assistant",
            content:           data.message           ?? "",
            suggested_actions: data.suggested_actions ?? [],
            isGreeting:        isProactive,
          },
        ]);
      } catch {
        setCopilotMessages((prev) => [
          ...prev,
          {
            role:              "assistant",
            content:           "I'm having trouble connecting right now. Please try again in a moment.",
            suggested_actions: [],
          },
        ]);
      } finally {
        setIsSending(false);
        setIsGreetingLoading(false);
      }
    },
    [location, activeWorkspace, copilotMessages],
  );

  // ── Send via ADK Agent ────────────────────────────────────────────────────
  const sendAgentMessage = useCallback(
    async (text: string) => {
      setAgentMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsSending(true);

      try {
        const res = await authPost("/api/ai-agents/run", {
          prompt:    text,
          sessionId: agentSessionId ?? undefined,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as { error?: string; code?: string };
          const errMsg =
            res.status === 503
              ? "The AI agent is not configured yet. Please contact your administrator."
              : res.status === 401
              ? "You need to be signed in to use the AI agent."
              : errData.error ?? `Request failed (${res.status}).`;
          throw new Error(errMsg);
        }

        const data = (await res.json()) as {
          output:    string;
          sessionId: string;
          toolCalls: ToolCall[];
        };

        if (data.sessionId) {
          setAgentSessionId(data.sessionId);
        }

        setAgentMessages((prev) => [
          ...prev,
          {
            role:      "assistant",
            content:   data.output    ?? "",
            toolCalls: data.toolCalls ?? [],
          },
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "I'm having trouble connecting right now. Please try again in a moment.";
        setAgentMessages((prev) => [
          ...prev,
          {
            role:      "assistant",
            content:   message,
            toolCalls: [],
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [agentSessionId],
  );

  // ── Switch mode (preserve per-mode history) ───────────────────────────────
  function handleModeChange(newMode: ChatMode) {
    if (newMode === mode) return;
    setMode(newMode);
    setInput("");
    if (newMode === "copilot" && copilotMessages.length === 0) {
      hasGreeted.current = false;
    }
  }

  // ── Trigger proactive greeting when switching to an empty Copilot tab ────
  useEffect(() => {
    if (!isOpen) return;
    if (mode !== "copilot") return;
    if (hasGreeted.current) return;
    if (copilotMessages.length > 0) {
      hasGreeted.current = true;
      return;
    }
    hasGreeted.current = true;
    void sendCopilotMessage("", true);
  }, [mode, isOpen, copilotMessages.length, sendCopilotMessage]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;
    setInput("");
    if (mode === "agent") {
      await sendAgentMessage(text);
    } else {
      await sendCopilotMessage(text);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ── Clear chat ────────────────────────────────────────────────────────────
  function clearChat() {
    if (mode === "copilot") {
      setCopilotMessages([]);
      hasGreeted.current = false;
    } else {
      setAgentMessages([]);
      setAgentSessionId(null);
    }
  }

  // ── Export to ticket ─────────────────────────────────────────────────────
  function exportToTicket() {
    if (messages.length === 0) return;
    const ts   = new Date().toISOString().replace(/[:.]/g, "-");
    const name = firstName ? `${firstName}_` : "";
    const lines = messages.map((m) => {
      const who = m.role === "user" ? "You" : "OmniCopilot";
      return `[${who}]\n${m.content}\n`;
    });
    const blob = new Blob(
      [`OmniCopilot Session — ${new Date().toLocaleString()}\n${"─".repeat(48)}\n\n${lines.join("\n")}`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement("a"), { href: url, download: `omni_ticket_${name}${ts}.txt` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const drawerVisible = isOpen && !isMinimised;

  const placeholderText = mode === "agent"
    ? "Ask about system health, platform capabilities…"
    : "Ask anything about this dashboard…";

  const subtitleText = mode === "agent"
    ? "ADK Agent · System & Platform"
    : (activeWorkspace ? activeWorkspace.clientName : "Powered by Gemini 2.5 Pro");

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Backdrop ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerVisible && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[398]"
            style={{ background: "rgba(2, 8, 23, 0.3)", backdropFilter: "blur(3px)" }}
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Drawer ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerVisible && (
          <motion.div
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING}
            className="fixed right-0 top-0 bottom-0 z-[400] flex flex-col shadow-2xl"
            style={{
              width:       DRAWER_W,
              background:  "#ffffff",
              borderLeft:  "1px solid rgba(0, 74, 198, 0.12)",
              fontFamily:  FONT,
            }}
          >
            {/* ── Header ────────────────────────────────────────────────── */}
            <div
              className="flex items-center gap-3 px-4 py-3.5 shrink-0"
              style={{ background: HEADER_BG }}
            >
              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.16)" }}
              >
                <span
                  className="material-symbols-outlined text-white"
                  style={{ fontSize: "17px", fontVariationSettings: "'FILL' 1" }}
                >
                  smart_toy
                </span>
              </div>

              {/* Title + mode toggle */}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <p
                  className="text-[13px] font-bold text-white leading-tight"
                  style={{ fontFamily: FONT }}
                >
                  {firstName ? `AI Assistant for ${firstName}` : "OmniCopilot"}
                </p>
                <p className="text-[10px] leading-tight" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {subtitleText}
                </p>
              </div>

              {/* Mode toggle */}
              <ModeToggle mode={mode} onChange={handleModeChange} />

              {/* Action buttons */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={exportToTicket}
                  disabled={messages.length === 0}
                  title="Export chat as ticket"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all disabled:opacity-30"
                  style={{ color: "rgba(255,255,255,0.55)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={clearChat}
                  disabled={messages.length === 0 && !isGreetingLoading}
                  title="Clear conversation"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all disabled:opacity-30"
                  style={{ color: "rgba(255,255,255,0.55)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fca5a5"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsMinimised(true)}
                  title="Minimise"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                  style={{ color: "rgba(255,255,255,0.55)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  title="Close"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                  style={{ color: "rgba(255,255,255,0.55)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Messages area ─────────────────────────────────────────── */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
              style={{ background: "#f8faff" }}
            >
              {/* Greeting loading */}
              {messages.length === 0 && isGreetingLoading && <TypingDots />}

              {/* Empty state */}
              {messages.length === 0 && !isGreetingLoading && (
                <div className="flex flex-col items-center justify-center h-full pt-8 pb-4 text-center gap-3">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                    style={{ background: HEADER_BG }}
                  >
                    <span
                      className="material-symbols-outlined text-white"
                      style={{ fontSize: "26px", fontVariationSettings: "'FILL' 1" }}
                    >
                      smart_toy
                    </span>
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-slate-800" style={{ fontFamily: FONT }}>
                      {mode === "agent"
                        ? "Ask the OmniAnalytix Agent"
                        : (firstName ? `Ask me anything, ${firstName}` : "Ask OmniCopilot")}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-[210px] mx-auto leading-relaxed" style={{ fontFamily: FONT }}>
                      {mode === "agent"
                        ? "Check system health, explore platform capabilities, or ask about available AI features."
                        : "I can analyse your dashboards, surface insights, and trigger actions."}
                    </p>
                    {mode === "agent" && (
                      <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                        {["What's the system health?", "List platform capabilities"].map((hint) => (
                          <button
                            key={hint}
                            onClick={() => { setInput(hint); setTimeout(() => inputRef.current?.focus(), 50); }}
                            className="px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors"
                            style={{
                              background:  "rgba(0,74,198,0.08)",
                              color:       "#004ac6",
                              border:      "1px solid rgba(0,74,198,0.15)",
                            }}
                          >
                            {hint}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Message list */}
              {messages.map((msg, i) => (
                <CopilotMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  suggested_actions={msg.suggested_actions}
                  toolCalls={msg.toolCalls}
                  isGreeting={msg.isGreeting}
                />
              ))}

              {/* Typing indicator */}
              {isSending && <TypingDots />}

              <div ref={bottomRef} />
            </div>

            {/* ── Input area ────────────────────────────────────────────── */}
            <div className="shrink-0 px-4 py-3 bg-white border-t border-slate-100">
              <div
                className="flex items-end gap-2 rounded-xl px-3 py-2.5 transition-shadow focus-within:shadow-sm"
                style={{
                  background:  "#f1f5fe",
                  border:      "1.5px solid rgba(0, 74, 198, 0.14)",
                  boxShadow:   "0 0 0 0 transparent",
                }}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholderText}
                  disabled={isSending}
                  rows={1}
                  className={cn(
                    "flex-1 resize-none bg-transparent text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none leading-relaxed",
                    "max-h-[120px] min-h-[20px] overflow-y-auto",
                  )}
                  style={{ fontFamily: FONT }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!input.trim() || isSending}
                  className={cn(
                    "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95",
                    input.trim() && !isSending ? "opacity-100" : "opacity-40 cursor-not-allowed",
                  )}
                  style={{
                    background: input.trim() && !isSending ? FAB_BG : "rgba(0,0,0,0.08)",
                    color:      input.trim() && !isSending ? "#fff" : "#94a3b8",
                  }}
                  aria-label="Send"
                >
                  {isSending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <p
                className="text-[10px] text-slate-400 text-center mt-2 select-none"
                style={{ fontFamily: FONT }}
              >
                {mode === "agent"
                  ? "OmniAnalytix Agent · ADK + Gemini"
                  : "OmniCopilot · Powered by Gemini 2.5 Pro"}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FAB ─────────────────────────────────────────────────────────── */}
      <button
        id="tour-omni-copilot-fab"
        onClick={() => {
          if (drawerVisible) {
            setIsOpen(false);
          } else {
            setIsOpen(true);
            setIsMinimised(false);
          }
        }}
        className={cn(
          "fixed z-[399] flex items-center justify-center rounded-full transition-all duration-200",
          "bottom-20 right-4 lg:bottom-6 lg:right-6",
          "hover:scale-110 active:scale-95",
          drawerVisible ? "w-10 h-10" : "w-14 h-14",
        )}
        style={{
          background:  drawerVisible ? "rgba(0,74,198,0.15)" : FAB_BG,
          border:      drawerVisible ? "2px solid rgba(0,74,198,0.3)" : "none",
          boxShadow:   drawerVisible
            ? "none"
            : "0 4px 20px rgba(0, 74, 198, 0.45), 0 0 0 0 rgba(0, 74, 198, 0)",
        }}
        aria-label="Open OmniCopilot"
      >
        {/* Glow pulse ring when not open */}
        {!drawerVisible && !isMinimised && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-30 pointer-events-none"
            style={{ background: FAB_BG }}
          />
        )}

        {drawerVisible ? (
          <X className="w-4 h-4 text-[#004ac6]" />
        ) : (
          <span
            className="material-symbols-outlined text-white relative z-10"
            style={{ fontSize: "24px", fontVariationSettings: "'FILL' 1" }}
          >
            smart_toy
          </span>
        )}

        {/* Unread badge when minimised */}
        {isMinimised && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-white animate-pulse" />
        )}
      </button>
    </>
  );
}
