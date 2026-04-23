import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { useWorkspace } from "@/contexts/workspace-context";
import { useToast } from "@/hooks/use-toast";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface LookerTemplate {
  id: number;
  name: string;
  lookerDashboardId: string;
  category: string;
  reportType: string;
}

interface EmbedSession {
  embedUrl: string;
  dashboardId: string;
  features: { sharing: boolean; downloading: boolean; filtering: boolean };
}

interface ExportState {
  status: "idle" | "pending" | "done" | "error" | "unconfigured";
  downloadUrl?: string;
  error?: string;
}

interface ReportViewerProps {
  templateId: number;
}

const CATEGORY_COLOR: Record<string, string> = {
  general:   "bg-slate-100 text-slate-500",
  ecom:      "bg-emerald-50 text-emerald-600",
  ads:       "bg-blue-50 text-blue-600",
  leadgen:   "bg-violet-50 text-violet-600",
  hybrid:    "bg-amber-50 text-amber-600",
  executive: "bg-rose-50 text-rose-600",
};

export function ReportViewer({ templateId }: ReportViewerProps) {
  const { activeWorkspace }          = useWorkspace();
  const { toast }                    = useToast();
  const embedContainerRef            = useRef<HTMLDivElement>(null);
  const [template, setTemplate]      = useState<LookerTemplate | null>(null);
  const [embedSession, setEmbed]     = useState<EmbedSession | null>(null);
  const [loading, setLoading]        = useState(true);
  const [embedError, setEmbedError]  = useState<string | null>(null);
  const [exportState, setExport]     = useState<ExportState>({ status: "idle" });
  const [fullscreen, setFullscreen]  = useState(false);

  // ── Load template metadata, then fetch a signed embed session ─────────────
  const boot = useCallback(async () => {
    setLoading(true);
    setEmbedError(null);

    try {
      // 1. Fetch template definition
      const tRes = await authFetch(`${API_BASE}api/looker/templates/${templateId}`);
      if (!tRes.ok) throw new Error(tRes.status === 404 ? "Template not found." : "Failed to load template.");
      const t: LookerTemplate = await tRes.json();
      setTemplate(t);

      // 2. Request a signed embed URL from the backend.
      //    The backend injects client_id = activeWorkspace.id into the JWT
      //    user_attributes, enabling Looker's row-level security filter.
      const clientId = activeWorkspace?.id ? String(activeWorkspace.id) : "default";
      const params   = new URLSearchParams({
        dashboard_id: t.lookerDashboardId,
        client_id:    clientId,
        workspace_id: clientId,
        report_type:  t.reportType,
      });
      const eRes = await authFetch(`${API_BASE}api/looker/auth?${params}`);
      if (!eRes.ok) {
        const data = await eRes.json().catch(() => ({}));
        throw new Error(data?.error || "Looker authentication failed.");
      }
      const session: EmbedSession = await eRes.json();
      setEmbed(session);
    } catch (err: unknown) {
      setEmbedError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }, [templateId, activeWorkspace?.id]);

  useEffect(() => { boot(); }, [boot]);

  // ── Export / Download Presentation ────────────────────────────────────────
  const handleExport = async (format: "pdf" | "pptx" = "pdf") => {
    setExport({ status: "pending" });
    try {
      const res = await authFetch(`${API_BASE}api/looker/templates/${templateId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          workspaceId: activeWorkspace?.id ?? "default",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data?.configured === false) {
          setExport({ status: "unconfigured", error: data?.detail });
        } else {
          setExport({ status: "error", error: data?.error || "Export failed." });
        }
        return;
      }

      setExport({ status: "done", downloadUrl: data.downloadUrl });
      // Trigger download immediately
      window.open(data.downloadUrl, "_blank");
      toast({ title: "Export ready", description: `Your ${format.toUpperCase()} is downloading.` });
    } catch {
      setExport({ status: "error", error: "Export request failed. Check your connection." });
    }
  };

  const isPresentation = template?.reportType === "presentation";

  return (
    <div className={`flex flex-col ${fullscreen ? "fixed inset-0 z-50 bg-[#f8f9fb]" : "min-h-0"}`}>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
        {/* Template identity */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {template && (
            <>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${CATEGORY_COLOR[template.category] || CATEGORY_COLOR.general}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  {isPresentation ? "slideshow" : "dashboard"}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{template.name}</p>
                <p className="text-[10px] text-slate-400 font-mono">
                  Dashboard {template.lookerDashboardId}
                  {activeWorkspace?.clientName && (
                    <> · {activeWorkspace.clientName}</>
                  )}
                </p>
              </div>
            </>
          )}
          {loading && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[#1a73e8]/20 border-t-[#1a73e8] rounded-full animate-spin" />
              <span className="text-xs text-slate-500">Loading report…</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Reload */}
          <button
            onClick={boot}
            title="Reload"
            className="w-8 h-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
          </button>

          {/* Download Presentation */}
          {embedSession && (
            <div className="relative">
              <button
                onClick={() => handleExport("pdf")}
                disabled={exportState.status === "pending"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#1a73e8]/20 bg-blue-50/60 text-[#1a73e8] text-xs font-medium hover:bg-blue-50 disabled:opacity-60 transition-colors"
                title={isPresentation ? "Download as PDF" : "Export PDF"}
              >
                {exportState.status === "pending" ? (
                  <span className="w-3 h-3 border border-[#1a73e8]/30 border-t-[#1a73e8] rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
                )}
                {exportState.status === "pending" ? "Rendering…" : "Download PDF"}
              </button>

              {/* PPTX option for presentation type */}
              {isPresentation && exportState.status !== "pending" && (
                <button
                  onClick={() => handleExport("pptx")}
                  className="ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:border-slate-300 transition-colors"
                  title="Download as PPTX"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>slideshow</span>
                  PPTX
                </button>
              )}
            </div>
          )}

          {/* Fullscreen */}
          <button
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="w-8 h-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {fullscreen ? "fullscreen_exit" : "fullscreen"}
            </span>
          </button>
        </div>
      </div>

      {/* ── Export status banners ──────────────────────────────────────────── */}
      {exportState.status === "unconfigured" && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start">
          <span className="material-symbols-outlined text-amber-500 flex-shrink-0 mt-0.5" style={{ fontSize: 18 }}>warning</span>
          <div>
            <p className="text-xs font-semibold text-amber-800">Looker API credentials not configured</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{exportState.error}</p>
          </div>
          <button onClick={() => setExport({ status: "idle" })} className="ml-auto text-amber-500 hover:text-amber-700">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}
      {exportState.status === "error" && (
        <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex gap-3 items-start">
          <span className="material-symbols-outlined text-rose-500 flex-shrink-0 mt-0.5" style={{ fontSize: 18 }}>error</span>
          <p className="text-xs text-rose-700">{exportState.error}</p>
          <button onClick={() => setExport({ status: "idle" })} className="ml-auto text-rose-500 hover:text-rose-700">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}

      {/* ── Embed viewport ────────────────────────────────────────────────── */}
      <div className="flex-1 relative bg-white overflow-hidden" style={{ minHeight: fullscreen ? 0 : 540 }}>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white z-10">
            <div className="w-10 h-10 border-2 border-[#1a73e8]/20 border-t-[#1a73e8] rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Authenticating Looker session…</p>
          </div>
        )}

        {embedError && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#f8f9fb]">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
              <span className="material-symbols-outlined text-amber-500" style={{ fontSize: 26 }}>warning</span>
            </div>
            <div className="text-center max-w-sm">
              <p className="text-sm font-semibold text-slate-700">Looker Connection Required</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{embedError}</p>
              <p className="text-[11px] text-slate-400 mt-2">
                Ensure <code className="bg-white px-1 rounded">LOOKER_HOST</code> and{" "}
                <code className="bg-white px-1 rounded">LOOKER_EMBED_SECRET</code> are configured.
              </p>
            </div>
            <button
              onClick={boot}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1a73e8] text-white text-sm font-medium hover:bg-[#1a66d0] transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              Retry
            </button>
          </div>
        )}

        {/* SDK embed target — the Looker Embed SDK will append an iframe here */}
        <div ref={embedContainerRef} className="absolute inset-0" />

        {/* Fallback: signed URL iframe (used when SDK connection fails or no SDK) */}
        {!loading && !embedError && embedSession && (
          <iframe
            key={embedSession.embedUrl}
            src={embedSession.embedUrl}
            className="absolute inset-0 w-full h-full border-0"
            title={`Looker — ${template?.name || "Report"}`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
            allow="fullscreen"
          />
        )}

        {/* Presentation overlay: semi-transparent glass header mask so Looker's
            own header appears hidden to the viewer even if URL params aren't honoured */}
        {isPresentation && !loading && !embedError && embedSession && (
          <div
            className="absolute top-0 inset-x-0 pointer-events-none"
            style={{
              height: 56,
              background: "linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)",
              zIndex: 5,
            }}
          />
        )}
      </div>

      {/* ── Footer: client context pill ───────────────────────────────────── */}
      {activeWorkspace && !fullscreen && (
        <div className="flex items-center gap-2 px-4 py-2 bg-white border-t border-slate-100 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <p className="text-[11px] text-slate-400">
            Filtered for{" "}
            <span className="font-semibold text-slate-600">{activeWorkspace.clientName}</span>
            {" "}— client_id{" "}
            <code className="font-mono text-[10px] bg-slate-100 px-1 rounded">{activeWorkspace.id}</code>
          </p>
        </div>
      )}
    </div>
  );
}
