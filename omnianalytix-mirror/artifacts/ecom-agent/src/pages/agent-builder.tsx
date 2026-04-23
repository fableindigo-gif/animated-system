import { useState, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, Link } from "wouter";
import { authFetch, authPost, authDelete } from "@/lib/auth-fetch";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bot, Plus, Trash2, Settings, MessageSquare, Zap,
  Activity, RefreshCw, ChevronRight, Search,
} from "lucide-react";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface AiAgent {
  id:                 number;
  name:               string;
  toneOfVoice:        string;
  objective:          string;
  primaryColor:       string;
  welcomeMessage:     string;
  scriptId:           string | null;
  isActive:           boolean;
  totalConversations: number;
  totalMessages:      number;
  createdAt:          string;
}

const OBJECTIVE_ICONS: Record<string, string> = {
  "Customer Support": "support_agent",
  "Sales Closing":    "trending_up",
  "Lead Generation":  "person_add",
  "FAQ":              "help",
};

const TONE_COLORS: Record<string, string> = {
  "Professional": "bg-blue-50 text-blue-700 border-blue-200",
  "Friendly":     "bg-amber-50 text-amber-700 border-amber-200",
  "Formal":       "bg-slate-50 text-slate-700 border-slate-200",
  "Casual":       "bg-green-50 text-green-700 border-green-200",
  "Empathetic":   "bg-rose-50 text-rose-700 border-rose-200",
};

export default function AgentBuilderPage() {
  const [, setLocation]        = useLocation();
  const [agents, setAgents]    = useState<AiAgent[]>([]);
  const [loading, setLoading]  = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch]    = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]  = useState("");
  const [newObjective, setNewObjective] = useState("Customer Support");
  const [newTone, setNewTone]  = useState("Professional");
  const [createErr, setCreateErr] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res  = await authFetch(`${API_BASE}api/ai-agents`);
      if (!res.ok) {
        setLoadError(`Could not load agents (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json() as { agents: AiAgent[] };
      setAgents(data.agents);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error — could not load agents.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAgents(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const res  = await authPost(`${API_BASE}api/ai-agents`, {
        name: newName.trim(), objective: newObjective, toneOfVoice: newTone,
      });
      const data = await res.json() as { agent?: AiAgent; error?: string };
      if (!res.ok) { setCreateErr(data.error ?? "Failed to create agent"); return; }
      setShowCreate(false);
      setNewName("");
      setLocation(`/agent-builder/${data.agent!.id}`);
    } finally { setCreating(false); }
  };

  const handleDelete = async (id: number, e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!confirm("Delete this agent and all its knowledge base data?")) return;
    await authDelete(`${API_BASE}api/ai-agents/${id}`);
    setAgents((a) => a.filter((ag) => ag.id !== id));
  };

  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.objective.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center">
              <Bot className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">AI Agent Builder</h1>
              <p className="text-sm text-slate-500 mt-0.5">Deploy white-label conversational agents for clients</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchAgents} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
              <RefreshCw className="w-4 h-4" />
            </button>
            <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
              <Plus className="w-4 h-4" /> New Agent
            </Button>
          </div>
        </div>

        {/* ── Create modal ── */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 space-y-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-indigo-600" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Create New Agent</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Agent Name *</label>
                  <input
                    type="text"
                    value={newName}
                    onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
                    placeholder="e.g., SupportBot, SalesCoach"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Objective</label>
                  <div className="grid grid-cols-2 gap-2">
                    {["Customer Support", "Sales Closing", "Lead Generation", "FAQ"].map((obj) => (
                      <button
                        key={obj}
                        onClick={() => setNewObjective(obj)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl text-xs font-semibold border text-left transition-all",
                          newObjective === obj
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300",
                        )}
                      >
                        <span className="material-symbols-outlined mr-1" style={{ fontSize: 14, verticalAlign: "middle" }}>
                          {OBJECTIVE_ICONS[obj]}
                        </span>
                        {obj}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Tone of Voice</label>
                  <select
                    value={newTone}
                    onChange={(e) => setNewTone((e.target as HTMLSelectElement).value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {["Professional", "Friendly", "Formal", "Casual", "Empathetic"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {createErr && (
                  <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{createErr}</p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {creating ? "Creating…" : "Create Agent"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Stats row ── */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Agents",  value: agents.length,                            icon: <Bot className="w-4 h-4 text-indigo-500" />       },
              { label: "Active",        value: agents.filter((a) => a.isActive).length,  icon: <Activity className="w-4 h-4 text-emerald-500" />   },
              { label: "Scripts Live",  value: agents.filter((a) => a.scriptId).length, icon: <Zap className="w-4 h-4 text-amber-500" />         },
              { label: "Total Messages",value: agents.reduce((acc, a) => acc + a.totalMessages, 0), icon: <MessageSquare className="w-4 h-4 text-blue-500" /> },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-xs text-slate-500 font-medium">{s.label}</span></div>
                <p className="text-2xl font-bold text-slate-900">{s.value.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Search ── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search agents…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>

        {/* ── Agent cards ── */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 h-48 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-16 px-6 bg-rose-50/60 border border-rose-100 rounded-2xl">
            <p className="text-sm font-semibold text-rose-700">{loadError}</p>
            <button
              onClick={fetchAgents}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-700 rounded-xl text-xs font-bold hover:bg-rose-100 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <Bot className="w-8 h-8 text-indigo-300" />
            </div>
            <p className="text-slate-500 font-medium">
              {search ? "No agents match your search." : "No agents yet. Create your first AI agent!"}
            </p>
            {!search && (
              <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                <Plus className="w-4 h-4" /> New Agent
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((agent) => (
              <div
                key={agent.id}
                onClick={() => setLocation(`/agent-builder/${agent.id}`)}
                className="group rounded-2xl border border-slate-200 bg-white p-5 cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all space-y-4"
              >
                {/* Card header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm"
                      style={{ background: agent.primaryColor }}
                    >
                      {agent.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">{agent.name}</p>
                      <span className={cn("inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border", TONE_COLORS[agent.toneOfVoice])}>
                        {agent.toneOfVoice}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(agent.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Objective */}
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="material-symbols-outlined text-indigo-500" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>
                    {OBJECTIVE_ICONS[agent.objective] ?? "smart_toy"}
                  </span>
                  {agent.objective}
                </div>

                {/* Status */}
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", agent.isActive ? "bg-emerald-400" : "bg-slate-300")} />
                  <span className="text-xs text-slate-500">{agent.isActive ? "Active" : "Inactive"}</span>
                  {agent.scriptId && (
                    <span className="ml-auto text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-mono font-semibold">LIVE</span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-100">
                  <span>{agent.totalMessages.toLocaleString()} msgs</span>
                  <span>{agent.totalConversations.toLocaleString()} convos</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-300 group-hover:text-indigo-400 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── How it works ── */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50/60 to-slate-50 p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">How the Agent Builder Works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              { icon: "tune",           title: "Configure",    desc: "Set name, tone, and objective for your client's agent" },
              { icon: "upload_file",    title: "Upload KB",    desc: "Upload PDFs, brand guides, and CSV chat transcripts" },
              { icon: "auto_awesome",   title: "RAG Powers",   desc: "Embeddings + pgvector for context-aware responses" },
              { icon: "code",           title: "Embed Script", desc: "One <script> tag deploys the widget on any storefront" },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-indigo-600" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">{item.title}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  );
}
