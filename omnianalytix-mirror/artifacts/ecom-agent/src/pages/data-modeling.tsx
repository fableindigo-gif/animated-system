import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Code2, Calculator, Hash, Type, Loader2, X, Sparkles, Layers3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Metric {
  id: number;
  name: string;
  description: string | null;
  dataType: string;
  formula: string;
  createdAt: string;
}

const DATA_TYPE_OPTIONS = [
  { value: "number", label: "Number", icon: Hash },
  { value: "currency", label: "Currency", icon: Calculator },
  { value: "percentage", label: "Percentage", icon: Calculator },
  { value: "text", label: "Text", icon: Type },
];

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function MetricCard({ metric, onDelete }: { metric: Metric; onDelete: () => void }) {
  const typeOpt = DATA_TYPE_OPTIONS.find((t) => t.value === metric.dataType);
  const TypeIcon = typeOpt?.icon ?? Hash;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="bg-white rounded-2xl border ghost-border p-5 hover:shadow-md transition-shadow group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-container/15 flex items-center justify-center">
            <TypeIcon className="w-5 h-5 text-primary-m3" />
          </div>
          <div>
            <h3 className="font-semibold text-on-surface text-sm leading-tight">{metric.name}</h3>
            <span className="text-xs text-on-surface-variant capitalize">{typeOpt?.label ?? metric.dataType}</span>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-error-container/20 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5 text-error" />
        </button>
      </div>

      {metric.description && (
        <p className="text-xs text-on-surface-variant mb-3 line-clamp-2">{metric.description}</p>
      )}

      <div className="bg-surface-variant/20 rounded-xl p-3 mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Code2 className="w-3.5 h-3.5 text-on-surface-variant" />
          <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">Formula</span>
        </div>
        <code className="text-xs font-mono text-on-surface leading-relaxed break-all">{metric.formula}</code>
      </div>

      <span className="text-xs text-on-surface-variant">{timeAgo(metric.createdAt)}</span>
    </motion.div>
  );
}

function CreateMetricModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (m: Metric) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState("number");
  const [formula, setFormula] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim() || !formula.trim()) {
      setError("Name and formula are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await authFetch(`${BASE}/api/data-modeling/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, dataType, formula: formula.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create metric");
        return;
      }
      const metric = await res.json();
      onCreated(metric);
      setName("");
      setDescription("");
      setDataType("number");
      setFormula("");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="px-6 py-5 border-b ghost-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary-m3" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-on-surface">New Custom Metric</h2>
              <p className="text-xs text-on-surface-variant">Define a reusable calculation</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-variant/30 transition-colors">
            <X className="w-5 h-5 text-on-surface-variant" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Metric Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Blended ROAS"
              className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional explanation..."
              className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm outline-none focus:ring-2 ring-primary-m3/30"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Data Type</label>
            <div className="grid grid-cols-4 gap-2">
              {DATA_TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setDataType(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all",
                      dataType === opt.value
                        ? "border-primary-m3 bg-primary-container/10 text-primary-m3"
                        : "ghost-border text-on-surface-variant hover:border-primary-m3/30",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Formula *</label>
            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="e.g. (revenue - cost) / cost * 100"
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl bg-surface-variant/20 border ghost-border text-sm font-mono outline-none focus:ring-2 ring-primary-m3/30 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-error bg-error-container/10 px-3 py-2 rounded-xl">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t ghost-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm rounded-3xl ghost-border hover:bg-surface-variant/30 transition-colors text-on-surface-variant"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2.5 text-sm rounded-3xl bg-primary-m3 text-white font-medium hover:bg-primary-m3/90 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Metric
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function DataModeling() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/data-modeling/metrics`);
      if (res.ok) setMetrics(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const handleDelete = async (id: number) => {
    const res = await authFetch(`${BASE}/api/data-modeling/metrics/${id}`, { method: "DELETE" });
    if (res.ok) setMetrics((prev) => prev.filter((m) => m.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary-m3" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Custom Attribution Logic</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Define custom metrics, attribution rules, and calculated fields for your semantic layer
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-5 py-2.5 bg-primary-m3 text-white rounded-3xl font-medium hover:bg-primary-m3/90 transition-colors flex items-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          New Metric
        </button>
      </div>

      {metrics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 rounded-3xl bg-primary-container/20 flex items-center justify-center mb-6">
            <Layers3 className="w-10 h-10 text-primary-m3" />
          </div>
          <h3 className="text-xl font-semibold text-on-surface mb-2">No custom metrics yet</h3>
          <p className="text-on-surface-variant text-sm mb-6 text-center max-w-sm">
            Create custom metrics to build your semantic layer. Define formulas that combine your data sources.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="px-6 py-3 bg-primary-m3 text-white rounded-3xl font-medium hover:bg-primary-m3/90 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Your First Metric
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {metrics.map((m) => (
              <MetricCard key={m.id} metric={m} onDelete={() => handleDelete(m.id)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {creating && (
          <CreateMetricModal
            open={creating}
            onClose={() => setCreating(false)}
            onCreated={(m) => {
              setMetrics((prev) => [m, ...prev]);
              setCreating(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
