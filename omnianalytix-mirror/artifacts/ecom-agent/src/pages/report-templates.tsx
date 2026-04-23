import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { authFetch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

type ReportType = "interactive" | "presentation";

interface LookerTemplate {
  id: number;
  name: string;
  lookerDashboardId: string;
  category: string;
  reportType: string;
  agencyId: number | null;
  createdAt: string;
}

const CATEGORY_OPTIONS = [
  { value: "general",    label: "General" },
  { value: "ecom",       label: "E-Commerce" },
  { value: "ads",        label: "Advertising" },
  { value: "leadgen",    label: "Lead Generation" },
  { value: "hybrid",     label: "Hybrid" },
  { value: "executive",  label: "Executive / QBR" },
];

const REPORT_TYPE_OPTIONS: { value: ReportType; label: string; desc: string; icon: string }[] = [
  {
    value: "interactive",
    label: "Interactive Dashboard",
    desc: "Full Looker embed with filters and drill-downs enabled",
    icon: "dashboard",
  },
  {
    value: "presentation",
    label: "Static Presentation",
    desc: "Clean view stripped of Looker navigation, ideal for client handoffs and QBR slides",
    icon: "slideshow",
  },
];

const CATEGORY_ICON: Record<string, string> = {
  general:   "grid_view",
  ecom:      "shopping_cart",
  ads:       "campaign",
  leadgen:   "contact_page",
  hybrid:    "hub",
  executive: "star",
};

const CATEGORY_COLOR: Record<string, string> = {
  general:   "bg-slate-50 text-slate-600 border-slate-200",
  ecom:      "bg-emerald-50 text-emerald-600 border-emerald-200",
  ads:       "bg-blue-50 text-blue-600 border-blue-200",
  leadgen:   "bg-violet-50 text-violet-600 border-violet-200",
  hybrid:    "bg-amber-50 text-amber-600 border-amber-200",
  executive: "bg-rose-50 text-rose-600 border-rose-200",
};

const BLANK_FORM = {
  name: "",
  lookerDashboardId: "",
  category: "general",
  reportType: "interactive" as ReportType,
};

export default function ReportTemplates() {
  const [, navigate]         = useLocation();
  const { toast }            = useToast();
  const [templates, setTemplates] = useState<LookerTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm]           = useState(BLANK_FORM);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}api/looker/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } catch {
      // silent — empty state handled by UI
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Please enter a template name.", variant: "destructive" });
      return;
    }
    if (!form.lookerDashboardId.trim()) {
      toast({ title: "Dashboard ID required", description: "Enter the Looker Dashboard ID.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}api/looker/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("non-ok");
      toast({ title: "Template registered", description: `"${form.name}" is now available in the Report Viewer.` });
      setForm(BLANK_FORM);
      setShowForm(false);
      await load();
    } catch {
      toast({ title: "Save failed", description: "Could not register template. Check your connection.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: LookerTemplate) => {
    setDeletingId(t.id);
    try {
      const res = await authFetch(`${API_BASE}api/looker/templates/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("non-ok");
      toast({ title: "Template removed", description: `"${t.name}" has been deleted.` });
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb] pb-16">
      {/* ── Page header ── */}
      <div className="px-6 pt-6 pb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 font-heading tracking-tight">
            Report Templates
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Register Looker dashboards as reusable report templates. Each template is
            client-scoped via dynamic JWT filter injection.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a73e8] text-white text-sm font-medium shadow-sm hover:bg-[#1a66d0] transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {showForm ? "close" : "add"}
          </span>
          {showForm ? "Cancel" : "Register Template"}
        </button>
      </div>

      <div className="px-6 space-y-4">
        {/* ── Add template form ── */}
        {showForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
            <h2 className="text-sm font-semibold text-slate-800">New Template</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Template Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Weekly Performance, Executive QBR"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Looker Dashboard ID</label>
                <input
                  type="text"
                  value={form.lookerDashboardId}
                  onChange={(e) => setForm((f) => ({ ...f, lookerDashboardId: e.target.value }))}
                  placeholder="e.g. 42 or my_dashboard_slug"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8]"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Report Type</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {REPORT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, reportType: opt.value }))}
                    className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                      form.reportType === opt.value
                        ? "border-[#1a73e8] bg-blue-50/60 ring-1 ring-[#1a73e8]/20"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      form.reportType === opt.value ? "bg-[#1a73e8]/10" : "bg-slate-100"
                    }`}>
                      <span className={`material-symbols-outlined ${
                        form.reportType === opt.value ? "text-[#1a73e8]" : "text-slate-500"
                      }`} style={{ fontSize: 18 }}>
                        {opt.icon}
                      </span>
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${
                        form.reportType === opt.value ? "text-[#1a73e8]" : "text-slate-700"
                      }`}>{opt.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1a73e8] text-white text-sm font-medium shadow-sm hover:bg-[#1a66d0] disabled:opacity-60 transition-colors"
              >
                {saving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>save</span>
                )}
                {saving ? "Saving…" : "Register Template"}
              </button>
            </div>
          </div>
        )}

        {/* ── Templates list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[#1a73e8]/20 border-t-[#1a73e8] rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Loading templates…</p>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#1a73e8]" style={{ fontSize: 32 }}>
                dashboard_customize
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">No templates yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Register your first Looker dashboard template above. Templates are shared across all
                client workspaces and filtered dynamically via JWT user attributes.
              </p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs text-[#1a73e8] font-medium hover:underline"
            >
              Register your first template →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center gap-4 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${CATEGORY_COLOR[t.category] || CATEGORY_COLOR.general}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {CATEGORY_ICON[t.category] || "grid_view"}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                    <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium tracking-wider ${CATEGORY_COLOR[t.category] || CATEGORY_COLOR.general}`}>
                      {(t.category || "general").toUpperCase()}
                    </span>
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium tracking-wider bg-slate-50 text-slate-500 border-slate-200">
                      {t.reportType === "presentation" ? "PRESENTATION" : "INTERACTIVE"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    Dashboard ID: <span className="text-slate-700">{t.lookerDashboardId}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => navigate(`/reports/${t.id}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#1a73e8] border border-[#1a73e8]/20 bg-blue-50/50 hover:bg-blue-50 transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
                    View
                  </button>
                  <button
                    onClick={() => handleDelete(t)}
                    disabled={deletingId === t.id}
                    className="flex items-center justify-center w-8 h-8 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-40"
                    title="Delete template"
                  >
                    {deletingId === t.id ? (
                      <span className="w-3 h-3 border border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                    ) : (
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Info banner ── */}
        <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 flex gap-3">
          <span className="material-symbols-outlined text-[#1a73e8] flex-shrink-0 mt-0.5" style={{ fontSize: 18 }}>
            info
          </span>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700">Dynamic JWT filter injection</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Each report embed is signed with the active client workspace ID as a Looker user attribute
              (<code className="bg-white/70 px-1 rounded text-[10px]">client_id</code>). Looker applies this as
              a row-level filter so a single dashboard template securely serves every client without duplicating content.
              Set <code className="bg-white/70 px-1 rounded text-[10px]">LOOKER_EMBED_SECRET</code> to activate embeds
              and <code className="bg-white/70 px-1 rounded text-[10px]">LOOKER_API_CLIENT_ID</code> /
              <code className="bg-white/70 px-1 rounded text-[10px]">LOOKER_API_CLIENT_SECRET</code> to enable PDF export.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
