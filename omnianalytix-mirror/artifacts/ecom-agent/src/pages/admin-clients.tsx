import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { Plus, Building2, Users, Cable, Loader2, Search, ChevronRight, Check } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OrgRow {
  id: number;
  name: string;
  slug: string;
  subscriptionTier: string | null;
  createdAt: string;
  memberCount: number;
  connectionCount: number;
  workspaceCount: number;
}

export default function AdminClientsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", slug: "", adminEmail: "", goal: "ecom" as "ecom" | "leadgen" | "hybrid" });

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/admin/organizations`);
      if (res.ok) {
        const data = await res.json();
        setOrgs(data);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      setError("Organization name and slug are required.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await authFetch(`${BASE}/api/admin/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to create organization");
      }
      setCreated(true);
      setTimeout(() => {
        setShowCreate(false);
        setCreated(false);
        setForm({ name: "", slug: "", adminEmail: "", goal: "ecom" });
        fetchOrgs();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const filtered = orgs.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSlugify = (name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      slug: prev.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    }));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">Client Accounts</h1>
          <p className="text-sm text-on-surface-variant mt-1">Each entry is a top-level account — with its own isolated workspace, team, and billing. Use the sidebar workspace switcher to add campaign workspaces within your current account.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="shrink-0 whitespace-nowrap inline-flex items-center gap-2 px-5 py-2.5 bg-primary-container text-white rounded-xl text-sm font-bold hover:bg-primary-m3 transition-all active:scale-[0.97] shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Client
        </button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
        <input
          type="text"
          placeholder="Search organizations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm bg-white focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none transition-all"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-on-surface-variant" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Building2 className="w-12 h-12 mx-auto text-surface-container-highest mb-4" />
          <p className="text-on-surface-variant font-medium">{search ? "No matching organizations" : "No client organizations yet"}</p>
          <p className="text-sm text-on-surface-variant mt-1">Click "New Client" to provision one after closing a deal.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((org) => (
            <div key={org.id} className="bg-white border border-outline-variant/15 rounded-2xl p-5 hover:shadow-md transition-all group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary-container/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary-container" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">{org.name}</h3>
                    <p className="text-xs text-on-surface-variant mt-0.5 font-mono">{org.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{org.memberCount} members</span>
                    <span className="flex items-center gap-1.5"><Cable className="w-3.5 h-3.5" />{org.connectionCount} connections</span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider",
                    org.subscriptionTier === "pro" ? "bg-emerald-50 text-emerald-700" : org.subscriptionTier === "demo" ? "bg-amber-50 text-amber-700" : "bg-surface-container-low text-on-surface-variant",
                  )}>
                    {org.subscriptionTier || "free"}
                  </span>
                  <ChevronRight className="w-4 h-4 text-on-surface-variant group-hover:text-primary-container transition-colors" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:p-4" onClick={() => !creating && setShowCreate(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md overflow-hidden sm:mx-auto max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 border-b ghost-border">
              <h2 className="text-lg font-bold text-on-surface">Provision New Client</h2>
              <p className="text-sm text-on-surface-variant mt-1">Set up an organization for a new client after closing the deal.</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Organization Name</label>
                <input
                  type="text"
                  placeholder="Acme Growth Agency"
                  value={form.name}
                  onChange={(e) => handleSlugify(e.target.value)}
                  className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Slug</label>
                <input
                  type="text"
                  placeholder="acme-growth"
                  value={form.slug}
                  onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-mono focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Client Admin Email (optional)</label>
                <input
                  type="email"
                  placeholder="admin@acme.com"
                  value={form.adminEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, adminEmail: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-outline-variant/15 rounded-xl text-sm focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Primary Goal</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["ecom", "leadgen", "hybrid"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setForm((prev) => ({ ...prev, goal: g }))}
                      className={cn(
                        "py-2.5 rounded-xl text-xs font-bold border-2 transition-all",
                        form.goal === g
                          ? "border-primary-container bg-primary-container/10 text-primary-container"
                          : "border-outline-variant/15 text-on-surface-variant hover:border-outline-variant/30",
                      )}
                    >
                      {g === "ecom" ? "E-Commerce" : g === "leadgen" ? "Lead Gen" : "Hybrid"}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-error-m3 font-medium">{error}</p>}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="flex-1 py-2.5 border border-outline-variant/15 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || created}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  created
                    ? "bg-emerald-500 text-white"
                    : "bg-primary-container text-white hover:bg-primary-m3 active:scale-[0.98]",
                )}
              >
                {created ? (
                  <><Check className="w-4 h-4" /> Created!</>
                ) : creating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                ) : (
                  "Create Organization"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
