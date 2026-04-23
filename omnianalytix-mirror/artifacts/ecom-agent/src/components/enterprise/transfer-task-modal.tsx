import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { ArrowRightLeft, User, MessageSquare, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLE_LABELS: Record<string, string> = {
  admin: "Agency Principal",
  manager: "Account Director",
  it: "IT Architect",
  analyst: "Media Buyer",
  viewer: "Client Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-primary-container/10 text-primary-container",
  manager: "bg-amber-50 text-amber-700",
  it: "bg-purple-50 text-purple-700",
  analyst: "bg-emerald-50 text-emerald-700",
  viewer: "bg-surface-container-low text-on-surface-variant",
};

interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface TransferTaskModalProps {
  open: boolean;
  onClose: () => void;
  taskId: number;
  taskTitle: string;
  onTransferred?: () => void;
}

export function TransferTaskModal({ open, onClose, taskId, taskTitle, onTransferred }: TransferTaskModalProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setNote("");
    setError("");
    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch(`${BASE}/api/team`);
        if (res.ok) {
          const data = await res.json();
          const arr = Array.isArray(data) ? data : data.data ?? [];
          setMembers(arr.filter((m: TeamMember) => m.isActive));
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    load();
  }, [open]);

  const handleTransfer = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await authFetch(`${BASE}/api/tasks/${taskId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMemberId: selectedId, note }),
      });
      if (res.ok) {
        onTransferred?.();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data as Record<string, string>).error || "Transfer failed");
      }
    } catch {
      setError("Network error");
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="p-6 pb-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary-container/10 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-primary-container" />
            </div>
            <div className="text-left">
              <DialogTitle className="font-bold text-base text-on-surface">Transfer Task</DialogTitle>
              <DialogDescription className="text-[10px] text-on-surface-variant mt-0.5 truncate max-w-[240px]">{taskTitle}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-5">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2 block">
              Assign to Team Member
            </label>
            {loading ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-outline-variant" />
                <span className="text-xs text-on-surface-variant">Loading team...</span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl border transition-all text-left",
                      selectedId === m.id
                        ? "border-primary-container bg-primary-container/10/50 ring-1 ring-primary-container/20"
                        : "ghost-border hover:border-outline-variant/15 hover:bg-surface",
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-on-surface-variant" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-on-surface truncate">{m.name}</p>
                      <p className="text-[10px] text-on-surface-variant truncate">{m.email}</p>
                    </div>
                    <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-2xl shrink-0", ROLE_COLORS[m.role] || ROLE_COLORS.viewer)}>
                      {ROLE_LABELS[m.role] || m.role}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2 block">
              <MessageSquare className="w-3 h-3 inline mr-1" />
              Consult Note (Optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for the recipient..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-2xl border border-outline-variant/15 text-sm bg-white placeholder:text-on-surface-variant outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-error-m3 font-medium">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-3 p-6 pt-0">
          <Button onClick={onClose} variant="outline" className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={() => void handleTransfer()}
            disabled={!selectedId || submitting}
            className="flex-1"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowRightLeft className="w-3.5 h-3.5" />
            )}
            Transfer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
