import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CreateTaskModalProps {
  onClose: () => void;
  onCreated: () => void;
}

const PLATFORM_OPTIONS = [
  { value: "google_ads", label: "Google Ads" },
  { value: "meta", label: "Meta Ads" },
  { value: "shopify", label: "Shopify" },
  { value: "gmc", label: "Google Merchant Center" },
  { value: "gsc", label: "Google Search Console" },
  { value: "internal", label: "Internal / Other" },
];

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical", color: "bg-error-container text-error-m3 border-error-m3/20" },
  { value: "high", label: "High", color: "bg-amber-50 text-amber-600 border-amber-200" },
  { value: "medium", label: "Medium", color: "bg-primary-container/10 text-primary-container border-primary-container/20" },
  { value: "low", label: "Low", color: "bg-surface-container-low text-on-surface-variant border-outline-variant/15" },
];

export function CreateTaskModal({ onClose, onCreated }: CreateTaskModalProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("internal");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`${BASE}/api/tasks/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          platform,
          priority,
          description: description.trim(),
          assignee: assignee.trim() || null,
        }),
      });
      if (res.ok) {
        toast({ title: "Task Created", description: "The task has been added to the queue." });
        onCreated();
        onClose();
      } else {
        toast({ title: "Error", description: "Could not create task.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border ghost-border w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b ghost-border">
          <div>
            <h2 className="text-base font-bold text-on-surface tracking-tight">Create Task</h2>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Manually assign a task to a team member</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container-highest flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-on-surface-variant" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Task Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Audit campaign budget allocations"
              className="w-full px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary-container/40 focus:outline-none focus:ring-2 focus:ring-primary-container/10 transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full px-3 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface bg-white focus:border-primary-container/40 focus:outline-none transition-all appearance-none"
              >
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Priority</label>
              <div className="flex gap-1.5">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPriority(opt.value)}
                    className={cn(
                      "flex-1 py-2 rounded-2xl text-[10px] font-bold border transition-all",
                      priority === opt.value
                        ? opt.color
                        : "ghost-border text-on-surface-variant hover:border-outline-variant/15",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the task, expected outcome, and any relevant context..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary-container/40 focus:outline-none focus:ring-2 focus:ring-primary-container/10 transition-all resize-none"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Assign To (optional)</label>
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Team member name"
              className="w-full px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary-container/40 focus:outline-none focus:ring-2 focus:ring-primary-container/10 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t ghost-border">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm font-medium text-on-surface-variant hover:bg-surface transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="px-5 py-2.5 rounded-2xl bg-primary-container text-white text-sm font-semibold hover:bg-primary-m3 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}
