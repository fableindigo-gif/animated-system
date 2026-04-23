import { useState, useEffect, useId } from "react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/workspace-context";
import { type Role, ROLE_LABELS, type TeamMember } from "@/contexts/user-role-context";
import { authPost } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Role catalogue ────────────────────────────────────────────────────────────

interface RoleDefinition {
  value: Role;
  label: string;
  governanceAlias: string;
  description: string;
  capability: "full" | "approve" | "propose" | "view";
  tags: string[];
  icon: string;
}

const ROLE_DEFS: RoleDefinition[] = [
  {
    value: "admin",
    label: ROLE_LABELS.admin,
    governanceAlias: "Agency Admin",
    description: "Full organization control — invites users, approves all impact levels, manages billing.",
    capability: "full",
    tags: ["All Access", "Approve", "Invite"],
    icon: "shield_person",
  },
  {
    value: "manager",
    label: ROLE_LABELS.manager,
    governanceAlias: "Senior Director",
    description: "Can approve medium- and high-impact actions. Manages team workflows and bulk audits.",
    capability: "approve",
    tags: ["Approve", "Manage"],
    icon: "manage_accounts",
  },
  {
    value: "analyst",
    label: ROLE_LABELS.analyst,
    governanceAlias: "Junior Buyer",
    description: "Can view all data and propose fixes for review. Cannot approve or deploy actions.",
    capability: "propose",
    tags: ["Propose", "Read"],
    icon: "rate_review",
  },
  {
    value: "it",
    label: ROLE_LABELS.it,
    governanceAlias: "IT Architect",
    description: "Manages API connections and OAuth integrations. Restricted from campaign budget changes.",
    capability: "propose",
    tags: ["API", "Integrations"],
    icon: "integration_instructions",
  },
  {
    value: "viewer",
    label: ROLE_LABELS.viewer,
    governanceAlias: "Client Viewer",
    description: "Read-only access to published reports and shared dashboards only.",
    capability: "view",
    tags: ["Read Only"],
    icon: "visibility",
  },
];

const CAPABILITY_BADGE: Record<string, { label: string; cls: string }> = {
  full:    { label: "Full Access",     cls: "bg-primary-container/10 text-primary-container border-primary-container/20" },
  approve: { label: "Can Approve",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  propose: { label: "Propose Only",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  view:    { label: "Read Only",       cls: "bg-surface-container-low text-on-surface-variant border-outline-variant/15" },
};

// ─── Component ─────────────────────────────────────────────────────────────────

interface InviteModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function InviteModal({ onClose, onSuccess }: InviteModalProps) {
  const { workspaces } = useWorkspace();
  const { toast } = useToast();
  const titleId = useId();

  const [name, setName]               = useState("");
  const [email, setEmail]             = useState("");
  const [role, setRole]               = useState<Role>("analyst");
  const [workspaceId, setWorkspaceId] = useState<number | null>(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [nameError, setNameError]     = useState<string | null>(null);
  const [emailError, setEmailError]   = useState<string | null>(null);
  const [successMember, setSuccessMember] = useState<TeamMember | null>(null);
  const [copied, setCopied]           = useState(false);

  const selectedRoleDef = ROLE_DEFS.find((r) => r.value === role)!;

  const inviteLink = successMember
    ? `${window.location.origin}${BASE}/join/${successMember.workspaceId != null ? "client" : "team"}?token=${successMember.inviteCode}`
    : "";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleCopy() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleSubmit() {
    let valid = true;
    setNameError(null);
    setEmailError(null);
    setError(null);

    if (!name.trim()) {
      setNameError("Full name is required.");
      valid = false;
    }
    if (!email.trim()) {
      setEmailError("Email address is required.");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Please enter a valid work email address.");
      valid = false;
    }
    if (!valid) return;

    setSaving(true);
    setError(null);

    try {
      const res = await authPost(`${BASE}/api/team`, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        workspaceId,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
        setError(body.error ?? body.message ?? "Failed to send invite.");
        return;
      }

      const member = await res.json() as TeamMember;
      toast({
        title: "Invite Created",
        description: `${name} has been invited as ${selectedRoleDef.governanceAlias}.`,
      });
      onSuccess();
      setSuccessMember(member);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
      >

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-8 py-6 border-b ghost-border">
          <div>
            <h2 id={titleId} className="text-xl font-bold tracking-tight text-on-surface">
              {successMember ? "Invite Created" : "Invite Team Member"}
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {successMember
                ? "Share the one-time invite link with the new team member."
                : "Assign a role and optionally scope access to a specific client workspace."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-primary-container/40 transition-all"
          >
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">close</span>
          </button>
        </div>

        {/* ── Success State ── */}
        {successMember ? (
          <div className="px-8 py-6 space-y-5">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-emerald-600" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-800">{successMember.name}</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  {successMember.email} · Invited as {selectedRoleDef.governanceAlias}
                </p>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1.5">
                One-Time Invite Link
              </label>
              <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
                Copy and share this link directly with <strong>{successMember.name}</strong>. It expires when they first sign in.
              </p>
              <div className="rounded-2xl border border-outline-variant/15 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-container-low border-b border-outline-variant/15">
                  <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Invite URL</span>
                  <span className="text-[10px] text-on-surface-variant">Single-use · expires on sign-in</span>
                </div>
                <div className="flex items-start gap-2 p-3">
                  <code className="flex-1 text-[10px] font-mono text-on-surface-variant break-all leading-relaxed">{inviteLink}</code>
                  <button
                    onClick={handleCopy}
                    data-testid="copy-invite-link"
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/15 bg-white hover:bg-surface text-on-surface-variant text-[10px] font-semibold transition-all"
                  >
                    {copied
                      ? <><span className="material-symbols-outlined text-[13px] text-emerald-600">check</span>Copied!</>
                      : <><span className="material-symbols-outlined text-[13px]">content_copy</span>Copy</>
                    }
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Role", value: selectedRoleDef.governanceAlias },
                { label: "Access Scope", value: workspaceId == null ? "All Clients" : (workspaces.find(w => w.id === workspaceId)?.clientName ?? `Workspace #${workspaceId}`) },
                { label: "Status", value: "Pending" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2.5">
                  <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className="text-[11px] font-semibold text-on-surface truncate">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setSuccessMember(null);
                  setName("");
                  setEmail("");
                  setRole("analyst");
                  setWorkspaceId(null);
                }}
                className="flex-1 py-2.5 border border-outline-variant/15 rounded-2xl text-sm font-semibold text-on-surface-variant hover:bg-surface transition-colors"
              >
                Invite Another
              </button>
              <button
                onClick={onClose}
                className="flex-[2] py-2.5 bg-primary-container hover:bg-primary-m3 text-white rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[16px]">done</span>
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form State ── */
          <>
            <div className="px-8 py-6 space-y-6">

              {error && (
                <div className="flex items-center gap-2 text-xs text-error-m3 bg-error-container/20 border border-error-m3/20 rounded-2xl px-4 py-3">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {error}
                </div>
              )}

              {/* Name + Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1.5">
                    Full Name
                  </label>
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }}
                    placeholder="e.g. Jane Smith"
                    autoFocus
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? "name-error" : undefined}
                    className={cn(
                      "w-full bg-white border rounded-2xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary-container/30 transition-all",
                      nameError ? "border-red-400 focus:ring-red-300" : "border-outline-variant/15 focus:border-primary-container/30",
                    )}
                  />
                  {nameError && (
                    <p id="name-error" className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">error</span>
                      {nameError}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1.5">
                    Work Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }}
                    placeholder="e.g. jane@company.com"
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? "email-error" : undefined}
                    className={cn(
                      "w-full bg-white border rounded-2xl px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary-container/30 transition-all",
                      emailError ? "border-red-400 focus:ring-red-300" : "border-outline-variant/15 focus:border-primary-container/30",
                    )}
                  />
                  {emailError && (
                    <p id="email-error" className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">error</span>
                      {emailError}
                    </p>
                  )}
                </div>
              </div>

              {/* Role selector — radiogroup for keyboard nav */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-2">
                  Role Assignment
                </label>
                <div
                  role="radiogroup"
                  aria-label="Role assignment"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                >
                  {ROLE_DEFS.map((def) => {
                    const isSelected = role === def.value;
                    const badge = CAPABILITY_BADGE[def.capability];
                    return (
                      <button
                        key={def.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        data-testid={`role-option-${def.value}`}
                        onClick={() => setRole(def.value)}
                        className={cn(
                          "text-left p-4 rounded-2xl border-2 transition-all duration-150",
                          isSelected
                            ? "border-primary-container bg-primary-container/5 shadow-sm"
                            : "border-outline-variant/15 hover:border-outline hover:bg-surface",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "material-symbols-outlined text-[18px]",
                                isSelected ? "text-primary-container" : "text-on-surface-variant",
                              )}
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              {def.icon}
                            </span>
                            <span className={cn("text-sm font-bold", isSelected ? "text-primary-container" : "text-on-surface")}>
                              {def.governanceAlias}
                            </span>
                          </div>
                          <span className={cn("text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border", badge.cls)}>
                            {badge.label}
                          </span>
                        </div>
                        <p className={cn("text-[11px] leading-relaxed", isSelected ? "text-on-surface" : "text-on-surface-variant")}>
                          {def.description}
                        </p>
                        {isSelected && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {def.tags.map((tag) => (
                              <span key={tag} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary-container/10 text-primary-container">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Access Scope — radiogroup for clear mutual exclusivity */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1.5">
                  Access Scope
                </label>
                <p className="text-[11px] text-on-surface-variant mb-2">
                  Grant access to all client workspaces, or restrict this member to a single account.
                </p>
                <div role="radiogroup" aria-label="Access scope" className="flex flex-col gap-2">
                  {/* All Clients option */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={workspaceId === null}
                    data-testid="scope-all-clients"
                    onClick={() => setWorkspaceId(null)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-all",
                      workspaceId === null
                        ? "border-primary-container bg-primary-container/5"
                        : "border-outline-variant/15 hover:border-outline hover:bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "material-symbols-outlined text-[18px]",
                        workspaceId === null ? "text-primary-container" : "text-on-surface-variant",
                      )}
                    >
                      corporate_fare
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm font-semibold", workspaceId === null ? "text-primary-container" : "text-on-surface")}>
                        All Clients
                      </span>
                      <p className="text-[11px] text-on-surface-variant">Org-wide access across every workspace</p>
                    </div>
                    {workspaceId === null && (
                      <span className="material-symbols-outlined text-[18px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                        check_circle
                      </span>
                    )}
                  </button>

                  {/* Individual workspaces */}
                  {workspaces.length > 0 && (
                    <div className="border border-outline-variant/15 rounded-2xl overflow-hidden divide-y divide-outline-variant/10 max-h-44 overflow-y-auto">
                      {workspaces.map((ws) => {
                        const isSelected = workspaceId === ws.id;
                        const hue = (ws.id * 83) % 360;
                        return (
                          <button
                            key={ws.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            data-testid={`scope-workspace-${ws.id}`}
                            onClick={() => setWorkspaceId(isSelected ? null : ws.id)}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                              isSelected ? "bg-primary-container/5" : "hover:bg-surface",
                            )}
                          >
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                              style={{ background: `hsl(${hue} 65% 42%)` }}
                            >
                              {ws.clientName.slice(0, 2).toUpperCase()}
                            </div>
                            <span className={cn("text-sm font-medium flex-1", isSelected ? "text-primary-container" : "text-on-surface")}>
                              {ws.clientName}
                            </span>
                            {isSelected && (
                              <span className="material-symbols-outlined text-[18px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                                check_circle
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="px-8 py-5 border-t ghost-border bg-surface/50 flex items-center justify-between gap-4">
              <div className="text-xs text-on-surface-variant">
                An invite link will be shown after submission — share it directly with the team member.
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-2xl border border-outline-variant/15 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="send-invite-btn"
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex items-center gap-2 bg-primary-container hover:bg-primary-m3 text-white px-6 py-2.5 rounded-2xl text-sm font-semibold active:scale-95 transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                      Sending…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">send</span>
                      Send Invite
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
