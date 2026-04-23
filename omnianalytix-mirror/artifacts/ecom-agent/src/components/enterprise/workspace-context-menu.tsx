import { useState, useRef, useEffect } from "react";
import { MoreVertical, Pencil, Users, Trash2, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/workspace-context";
import { authFetch } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface WorkspaceContextMenuProps {
  workspaceId: number;
  workspaceName: string;
}

export function WorkspaceContextMenu({ workspaceId, workspaceName }: WorkspaceContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-8 h-8 rounded-2xl hover:bg-surface-container-low flex items-center justify-center transition-colors"
      >
        <MoreVertical className="w-4 h-4 text-on-surface-variant" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-2xl bg-white border border-outline-variant/15 shadow-xl overflow-hidden">
          <button
            onClick={() => { setOpen(false); setEditOpen(true); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface transition-colors text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-on-surface-variant" />
            Edit Workspace
          </button>
          <button
            onClick={() => { setOpen(false); setShareOpen(true); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface transition-colors text-left"
          >
            <Users className="w-3.5 h-3.5 text-on-surface-variant" />
            Share Access
          </button>
          <div className="border-t ghost-border" />
          <button
            onClick={() => { setOpen(false); setDeleteOpen(true); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error-m3 hover:bg-error-container transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            Delete Workspace
          </button>
        </div>
      )}

      {editOpen && (
        <EditWorkspaceModal
          workspaceId={workspaceId}
          currentName={workspaceName}
          onClose={() => setEditOpen(false)}
        />
      )}
      {shareOpen && (
        <ShareAccessModal
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onClose={() => setShareOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteWorkspaceModal
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}

function EditWorkspaceModal({ workspaceId, currentName, onClose }: { workspaceId: number; currentName: string; onClose: () => void }) {
  const { toast } = useToast();
  const { refreshWorkspaces } = useWorkspace();
  const [name, setName] = useState(currentName);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await authFetch(`${BASE}/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: name.trim(), notes: notes.trim() || undefined }),
      });
      if (res.ok) {
        toast({ title: "Workspace Updated", description: "Changes saved successfully." });
        refreshWorkspaces();
        onClose();
      } else {
        toast({ title: "Error", description: "Could not update workspace.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit Workspace" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Client Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface focus:border-primary-container/40 focus:outline-none transition-all"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional internal notes..."
            rows={2}
            className="w-full px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary-container/40 focus:outline-none transition-all resize-none"
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="px-4 py-2 rounded-2xl border border-outline-variant/15 text-sm font-medium text-on-surface-variant hover:bg-surface transition-all">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || saving} className="px-5 py-2 rounded-2xl bg-primary-container text-white text-sm font-semibold hover:bg-primary-m3 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function ShareAccessModal({ workspaceId, workspaceName, onClose }: { workspaceId: number; workspaceName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const inviteLink = `${window.location.origin}${import.meta.env.BASE_URL}invite?ws=${workspaceId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast({ title: "Link Copied", description: "Share this link to grant access." });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ModalShell title="Share Access" onClose={onClose}>
      <p className="text-sm text-on-surface-variant mb-4">
        Share access to <span className="font-semibold text-on-surface">{workspaceName}</span> with team members.
      </p>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Invite Link</label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={inviteLink}
            className="flex-1 px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface-variant bg-surface focus:outline-none"
          />
          <button
            onClick={handleCopy}
            className={cn(
              "px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all",
              copied ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-primary-container text-white hover:bg-primary-m3 active:scale-95"
            )}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={onClose} className="px-4 py-2 rounded-2xl border border-outline-variant/15 text-sm font-medium text-on-surface-variant hover:bg-surface transition-all">Done</button>
      </div>
    </ModalShell>
  );
}

function DeleteWorkspaceModal({ workspaceId, workspaceName, onClose }: { workspaceId: number; workspaceName: string; onClose: () => void }) {
  const { toast } = useToast();
  const { refreshWorkspaces } = useWorkspace();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmText === workspaceName;

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const res = await authFetch(`${BASE}/api/workspaces/${workspaceId}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Workspace Deleted", description: `"${workspaceName}" has been permanently removed.` });
        refreshWorkspaces();
        onClose();
      } else {
        toast({ title: "Error", description: "Could not delete workspace.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ModalShell title="Delete Workspace" onClose={onClose}>
      <div className="bg-error-container border border-error-m3/20 rounded-2xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <Trash2 className="w-5 h-5 text-error-m3 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-800">This action is permanent</p>
            <p className="text-xs text-error-m3 mt-1 leading-relaxed">
              Deleting <span className="font-bold">"{workspaceName}"</span> will permanently remove all associated data, connections, alerts, and task history. This cannot be undone.
            </p>
          </div>
        </div>
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">
          Type "{workspaceName}" to confirm
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={workspaceName}
          className="w-full px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface placeholder:text-outline-variant focus:border-[#F87171] focus:outline-none transition-all"
        />
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="px-4 py-2 rounded-2xl border border-outline-variant/15 text-sm font-medium text-on-surface-variant hover:bg-surface transition-all">Cancel</button>
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          className="px-5 py-2 rounded-2xl bg-error-m3 text-white text-sm font-semibold hover:bg-rose-700 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Delete Permanently
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border ghost-border w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b ghost-border">
          <h2 className="text-base font-bold text-on-surface tracking-tight">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container-highest flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-on-surface-variant" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
