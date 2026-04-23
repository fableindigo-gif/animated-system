import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, Link } from "wouter";
import { authFetch, authPost, authDelete } from "@/lib/auth-fetch";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bot, Upload, Trash2, CheckCircle2, Clock, AlertCircle,
  Code, CreditCard, Settings, Database, Zap, Copy, Check,
  ChevronLeft, RefreshCw, FileText, FileSpreadsheet, File,
  ExternalLink, Activity,
} from "lucide-react";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AiAgent {
  id:                   number;
  name:                 string;
  toneOfVoice:          string;
  objective:            string;
  customObjective:      string | null;
  systemPrompt:         string | null;
  primaryColor:         string;
  welcomeMessage:       string;
  scriptId:             string | null;
  isActive:             boolean;
  stripeSubscriptionId: string | null;
  totalConversations:   number;
  totalMessages:        number;
  createdAt:            string;
}

interface KbDocument {
  id:           number;
  fileName:     string;
  fileType:     string;
  fileSize:     number;
  status:       string;
  chunkCount:   number;
  errorMessage: string | null;
  createdAt:    string;
}

type Tab = "config" | "knowledge" | "embed";

const TONES      = ["Professional", "Friendly", "Formal", "Casual", "Empathetic"];
const OBJECTIVES = ["Customer Support", "Sales Closing", "Lead Generation", "FAQ", "Custom"];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type === "pdf") return <FileText className="w-4 h-4 text-rose-500" />;
  if (type === "csv") return <FileSpreadsheet className="w-4 h-4 text-emerald-500" />;
  return <File className="w-4 h-4 text-slate-400" />;
}

function StatusDot({ status }: { status: string }) {
  if (status === "ready")      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === "processing") return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
  return <AlertCircle className="w-4 h-4 text-rose-500" />;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AgentBuilderDetailPage() {
  const [location, setLocation] = useLocation();

  // Extract agent ID from URL: /agent-builder/:id
  const match   = location.match(/\/agent-builder\/(\d+)/);
  const agentId = match ? parseInt(match[1], 10) : null;

  const [agent, setAgent]           = useState<AiAgent | null>(null);
  const [docs, setDocs]             = useState<KbDocument[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<Tab>("config");
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadErr, setUploadErr]   = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied]         = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Config form state
  const [name, setName]                       = useState("");
  const [tone, setTone]                       = useState("Professional");
  const [objective, setObjective]             = useState("Customer Support");
  const [customObjective, setCustomObjective] = useState("");
  const [systemPrompt, setSystemPrompt]       = useState("");
  const [primaryColor, setPrimaryColor]       = useState("#1a73e8");
  const [welcomeMessage, setWelcomeMessage]   = useState("Hi! How can I help you today?");

  const loadAgent = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const res  = await authFetch(`${API_BASE}api/ai-agents/${agentId}`);
      if (!res.ok) { setLocation("/agent-builder"); return; }
      const data = await res.json() as { agent: AiAgent; documents: KbDocument[] };
      setAgent(data.agent);
      setDocs(data.documents);
      setName(data.agent.name);
      setTone(data.agent.toneOfVoice);
      setObjective(data.agent.objective);
      setCustomObjective(data.agent.customObjective ?? "");
      setSystemPrompt(data.agent.systemPrompt ?? "");
      setPrimaryColor(data.agent.primaryColor);
      setWelcomeMessage(data.agent.welcomeMessage);
    } finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { loadAgent(); }, [loadAgent]);

  // Poll docs that are still processing
  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === "processing");
    if (!hasProcessing) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      if (!agentId) return;
      const res = await authFetch(`${API_BASE}api/ai-agents/${agentId}/documents`);
      if (res.ok) {
        const data = await res.json() as { documents: KbDocument[] };
        setDocs(data.documents);
      }
    }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [docs, agentId]);

  const handleSave = async () => {
    if (!agentId) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await authFetch(`${API_BASE}api/ai-agents/${agentId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name,
          toneOfVoice:     tone,
          objective:       objective === "Custom" ? "Custom" : objective,
          customObjective: objective === "Custom" ? customObjective : null,
          systemPrompt:    systemPrompt || null,
          primaryColor,
          welcomeMessage,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { agent: AiAgent };
        setAgent(data.agent);
        setSaveMsg("Saved!");
        setTimeout(() => setSaveMsg(null), 2500);
      } else {
        setSaveMsg("Failed to save.");
      }
    } finally { setSaving(false); }
  };

  const handleUpload = async (file: File) => {
    if (!agentId) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("omnianalytix_gate_token") ?? "";
      const res   = await fetch(`${API_BASE}api/ai-agents/${agentId}/documents`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });
      if (res.ok) {
        const data = await res.json() as { document: KbDocument };
        setDocs((prev) => [data.document, ...prev]);
      } else {
        const d = await res.json() as { error?: string };
        setUploadErr(d.error ?? "Upload failed");
      }
    } finally { setUploading(false); }
  };

  const handleDeleteDoc = async (docId: number) => {
    if (!agentId || !confirm("Delete this document and its embeddings?")) return;
    await authDelete(`${API_BASE}api/ai-agents/${agentId}/documents/${docId}`);
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleGenerateScript = async () => {
    if (!agentId) return;
    setGenerating(true);
    try {
      const res  = await authPost(`${API_BASE}api/ai-agents/${agentId}/generate-script`, {});
      const data = await res.json() as { agent: AiAgent };
      setAgent(data.agent);
    } finally { setGenerating(false); }
  };

  const handleSubscribe = async () => {
    if (!agentId) return;
    setSubscribing(true);
    try {
      const res  = await authPost(`${API_BASE}api/ai-agents/${agentId}/subscribe`, {});
      const data = await res.json() as { checkoutUrl?: string; alreadySubscribed?: boolean; error?: string };
      if (data.checkoutUrl) window.open(data.checkoutUrl, "_blank");
      else if (data.alreadySubscribed) {
        setAgent((a) => a ? { ...a, stripeSubscriptionId: "active" } : a);
      }
    } finally { setSubscribing(false); }
  };

  const copyScript = async () => {
    if (!agent?.scriptId) return;
    const domain = window.location.origin;
    await navigator.clipboard.writeText(
      `<script src="${domain}/api/ai-agents/widget.js?id=${agent.scriptId}" async></script>`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!agentId) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <p className="text-slate-400">Invalid agent ID.</p>
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-6 h-6 text-slate-300 animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!agent) return null;

  const scriptTag = agent.scriptId
    ? `<script src="${window.location.origin}/api/ai-agents/widget.js?id=${agent.scriptId}" async></script>`
    : null;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── Breadcrumb header ── */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/agent-builder">
              <button className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
                <ChevronLeft className="w-4 h-4" />
              </button>
            </Link>
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ background: agent.primaryColor }}
            >
              {agent.name[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{agent.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className={cn("w-1.5 h-1.5 rounded-full", agent.isActive ? "bg-emerald-400" : "bg-slate-300")} />
                <span className="text-xs text-slate-500">{agent.isActive ? "Active" : "Inactive"}</span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs text-slate-500">{agent.objective}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
            <span>{agent.totalMessages.toLocaleString()} msgs</span>
            <span>{agent.totalConversations.toLocaleString()} convos</span>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {([
            { id: "config",    icon: "tune",          label: "Configuration"  },
            { id: "knowledge", icon: "database",       label: "Knowledge Base" },
            { id: "embed",     icon: "code",           label: "Embed & Billing" },
          ] as { id: Tab; icon: string; label: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all",
                tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ════════════════ CONFIGURATION TAB ════════════════ */}
        {tab === "config" && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Agent Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Tone of Voice</label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                        tone === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Objective</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {OBJECTIVES.map((o) => (
                    <button
                      key={o}
                      onClick={() => setObjective(o)}
                      className={cn(
                        "px-3 py-2 rounded-xl text-xs font-semibold border text-left transition-all",
                        objective === o ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300",
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                {objective === "Custom" && (
                  <input
                    value={customObjective}
                    onChange={(e) => setCustomObjective(e.target.value)}
                    placeholder="Describe the agent's custom objective…"
                    className="mt-2 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Welcome Message</label>
                <input
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Brand Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-xl border border-slate-200 cursor-pointer p-0.5"
                  />
                  <span className="text-sm font-mono text-slate-600">{primaryColor}</span>
                  <div className="w-6 h-6 rounded-lg" style={{ background: primaryColor }} />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                  Custom System Prompt <span className="font-normal text-slate-400">(optional — overrides default)</span>
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  placeholder="You are a helpful assistant for {client name}. Your goal is to…"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              {saveMsg && (
                <span className={cn("text-xs font-semibold", saveMsg === "Saved!" ? "text-emerald-600" : "text-rose-600")}>
                  {saveMsg}
                </span>
              )}
              <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        )}

        {/* ════════════════ KNOWLEDGE BASE TAB ════════════════ */}
        {tab === "knowledge" && (
          <div className="space-y-4">
            {/* Upload zone */}
            <div
              className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-center hover:border-indigo-300 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer?.files[0];
                if (file) handleUpload(file);
              }}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Drop files or click to upload</p>
                  <p className="text-xs text-slate-400 mt-0.5">PDF, CSV, TXT — up to 20 MB</p>
                </div>
                <label className={cn(
                  "cursor-pointer px-4 py-2 rounded-xl text-xs font-semibold transition-all",
                  uploading ? "bg-slate-100 text-slate-400" : "bg-indigo-600 hover:bg-indigo-700 text-white",
                )}>
                  {uploading ? "Uploading…" : "Browse Files"}
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.csv,.txt"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(file);
                    }}
                  />
                </label>
              </div>
            </div>

            {uploadErr && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{uploadErr}
              </div>
            )}

            {/* KB stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Documents",    value: docs.length },
                { label: "Ready",        value: docs.filter((d) => d.status === "ready").length },
                { label: "Total Chunks", value: docs.reduce((acc, d) => acc + d.chunkCount, 0) },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                  <p className="text-xl font-bold text-slate-900">{s.value.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Document list */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {docs.length === 0 ? (
                <div className="flex flex-col items-center py-12 gap-3">
                  <Database className="w-8 h-8 text-slate-200" />
                  <p className="text-sm text-slate-400">No documents uploaded yet.</p>
                  <p className="text-xs text-slate-400 text-center max-w-xs">
                    Upload PDFs, brand guidelines, or CSV chat transcripts to give your agent a knowledge base.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 group">
                      <FileIcon type={doc.fileType} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{doc.fileName}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {fmtSize(doc.fileSize)} · {doc.chunkCount} chunks
                          {doc.errorMessage && ` · ${doc.errorMessage.substring(0, 60)}`}
                        </p>
                      </div>
                      <StatusDot status={doc.status} />
                      <span className="text-[10px] text-slate-400 font-mono capitalize">{doc.status}</span>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 flex items-start gap-3">
              <Zap className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-indigo-800">RAG Pipeline</p>
                <p className="text-[11px] text-indigo-700 mt-0.5 leading-relaxed">
                  Documents are chunked into 500-character segments, embedded using{" "}
                  <code className="bg-indigo-100 px-1 rounded">text-embedding-3-small</code> (1536 dims), and stored
                  in pgvector. Each chat query performs cosine-similarity search to retrieve the top-5 most relevant
                  chunks, injected as context into Gemini 2.5 Flash.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════ EMBED & BILLING TAB ════════════════ */}
        {tab === "embed" && (
          <div className="space-y-4">
            {/* Script generation */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">Embeddable Chat Widget</h2>
              </div>

              {scriptTag ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-700">Script Generated — Widget is Live</span>
                  </div>

                  <div className="relative rounded-xl bg-slate-900 p-4 font-mono text-xs text-emerald-300 overflow-x-auto">
                    <pre className="whitespace-pre-wrap break-all">{scriptTag}</pre>
                    <button
                      onClick={copyScript}
                      className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-600 leading-relaxed">
                    <p className="font-semibold text-slate-700 mb-1.5">How to deploy on Shopify:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Go to <strong>Online Store → Themes → Edit Code</strong></li>
                      <li>Open <code className="bg-white px-1 rounded border border-slate-200">theme.liquid</code></li>
                      <li>Paste the script tag just before <code className="bg-white px-1 rounded border border-slate-200">&lt;/body&gt;</code></li>
                      <li>Save — the chat widget will appear bottom-right on all storefront pages</li>
                    </ol>
                  </div>

                  <p className="text-[10px] text-slate-400 font-mono">
                    Script ID: <span className="text-slate-600 select-all">{agent.scriptId}</span>
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Generate a unique script tag to embed this agent as a floating chat widget on any Shopify or
                    WooCommerce storefront.
                  </p>
                  <Button
                    onClick={handleGenerateScript}
                    disabled={generating}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    {generating ? "Generating…" : "Generate Script Tag"}
                  </Button>
                </div>
              )}
            </div>

            {/* Billing */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">Agent Subscription</h2>
                <span className="ml-auto text-xs font-mono font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                  $150 / month
                </span>
              </div>

              {agent.stripeSubscriptionId ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-800">Subscription Active</p>
                    <p className="text-[10px] text-emerald-600 font-mono mt-0.5">{agent.stripeSubscriptionId}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Activate a recurring $150/month subscription for this agent. Each active agent has its own Stripe
                    subscription automatically billed to your agency account.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Hosting",   value: "Included"  },
                      { label: "RAG Calls", value: "Unlimited" },
                      { label: "Billing",   value: "Monthly"   },
                    ].map((f) => (
                      <div key={f.label} className="rounded-xl bg-slate-50 border border-slate-100 p-2.5 text-center">
                        <p className="text-xs font-bold text-slate-900">{f.value}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{f.label}</p>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={handleSubscribe}
                    disabled={subscribing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 w-full"
                  >
                    <CreditCard className="w-4 h-4" />
                    {subscribing ? "Redirecting to Stripe…" : "Activate — $150/mo"}
                  </Button>
                </div>
              )}
            </div>

            {/* Live config link */}
            {agent.scriptId && (
              <a
                href={`${API_BASE}api/ai-agents/config/${agent.scriptId}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-3.5 hover:border-indigo-300 hover:bg-indigo-50 transition-all group"
              >
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                  <span className="text-sm font-medium text-slate-600 group-hover:text-indigo-700">
                    View live agent config (JSON)
                  </span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500" />
              </a>
            )}
          </div>
        )}

      </div>
    </AppShell>
  );
}
