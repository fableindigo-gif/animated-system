import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useUserRole, ROLE_LABELS, type Role, type TeamMember } from "@/contexts/user-role-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { authPatch, authDelete } from "@/lib/auth-fetch";
import { useToast } from "@/hooks/use-toast";
import { InviteModal } from "@/components/team/invite-modal";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLES: Role[] = ["admin", "manager", "it", "analyst", "viewer"];

const ROLE_MATERIAL_ICONS: Record<Role, { icon: string; fill: boolean }> = {
  admin:   { icon: "shield_person",   fill: true },
  manager: { icon: "manage_accounts", fill: true },
  it:      { icon: "integration_instructions", fill: false },
  analyst: { icon: "analytics",       fill: false },
  viewer:  { icon: "visibility",      fill: false },
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin:   "Full organization control, billing management, and user provisioning.",
  manager: "Edit team workflows, run bulk audits, and approve insights reports.",
  it:      "Manages API connections, OAuth integrations, and data warehouse syncs. Restricted from altering campaign budgets.",
  analyst: "Create dashboards, perform deep-dive audits, and export raw data.",
  viewer:  "Read-only access to published reports and shared team dashboards.",
};

const ROLE_TAGS: Record<Role, string[]> = {
  admin:   ["All Access", "Approvals"],
  manager: ["Edit", "Approvals"],
  it:      ["API", "Integrations"],
  analyst: ["Create", "Export"],
  viewer:  ["Read Only"],
};

const ROLE_BADGE_COLORS: Record<Role, string> = {
  admin:   "bg-primary-container/10 text-primary-container",
  manager: "bg-amber-50 text-amber-700",
  it:      "bg-purple-50 text-purple-700",
  analyst: "bg-emerald-50 text-emerald-700",
  viewer:  "bg-surface-container-low text-on-surface-variant",
};


function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function getTimeSince(ts?: string | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 120_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000) return "Yesterday";
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function IOSSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-none",
        on ? "bg-primary-container" : "bg-surface-container-highest",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-[22px] w-[22px] rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out mt-[2px]",
          on ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

function RolePermissionsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-2xl animate-in slide-in-from-right duration-300 overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b ghost-border px-8 py-6 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold tracking-tight text-on-surface">Role Permissions</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">close</span>
          </button>
        </div>
        <div className="p-8 space-y-6">
          {ROLES.map((role) => {
            const iconDef = ROLE_MATERIAL_ICONS[role];
            return (
              <div key={role} className="p-5 rounded-2xl bg-surface space-y-3">
                <div className="flex items-center gap-3">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", ROLE_BADGE_COLORS[role])}>
                    <span
                      className="material-symbols-outlined text-lg"
                      style={iconDef.fill ? { fontVariationSettings: "'FILL' 1" } : undefined}
                    >
                      {iconDef.icon}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-on-surface">{ROLE_LABELS[role]}</h3>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant">{role}</span>
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">{ROLE_DESCRIPTIONS[role]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_TAGS[role].map((tag) => (
                    <span key={tag} className="bg-white text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ghost-border">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RowDropdown({ onEdit, onDelete, isPending, onCopy, onRevoke }: {
  onEdit?: () => void;
  onDelete?: () => void;
  isPending?: boolean;
  onCopy?: () => void;
  onRevoke?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-2xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
      >
        <span className="material-symbols-outlined text-[20px]">more_vert</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-2xl shadow-xl border ghost-border py-1 z-30 animate-in fade-in zoom-in-95 duration-150">
          {isPending ? (
            <>
              <button onClick={() => { onCopy?.(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface flex items-center gap-2.5 transition-colors">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">content_copy</span>
                Copy Invite Link
              </button>
              <button onClick={() => { onRevoke?.(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-error-m3 hover:bg-error-container flex items-center gap-2.5 transition-colors">
                <span className="material-symbols-outlined text-[18px]">cancel</span>
                Revoke Invite
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { onEdit?.(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface flex items-center gap-2.5 transition-colors">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">edit</span>
                Change Role
              </button>
              {onDelete && (
                <button onClick={() => { onDelete(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-error-m3 hover:bg-error-container flex items-center gap-2.5 transition-colors">
                  <span className="material-symbols-outlined text-[18px]">person_remove</span>
                  Remove Member
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Governance role alias mapping ─────────────────────────────────────────────

const GOVERNANCE_ALIAS: Record<Role, string> = {
  admin:   "Agency Admin",
  manager: "Senior Director",
  analyst: "Junior Buyer",
  it:      "IT Architect",
  viewer:  "Client Viewer",
};

const CAN_APPROVE: Role[] = ["admin", "manager"];

export default function TeamPage() {
  const { teamMembers, currentUser, setCurrentUser, refreshTeam } = useUserRole();
  const { workspaces } = useWorkspace();
  const { toast } = useToast();
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<Role>("analyst");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"users" | "security">("users");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dualAuth, setDualAuth] = useState(true);
  const [auditLock, setAuditLock] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: "", description: "", onConfirm: () => {} });

  function getWorkspaceName(id: number | null): string {
    if (id == null) return "All Clients";
    return workspaces.find((w) => w.id === id)?.clientName ?? `Workspace #${id}`;
  }

  function handleCopyInviteLink(member: TeamMember) {
    const type = member.workspaceId != null ? "client" : "team";
    const link = `${window.location.origin}${BASE}/join/${type}?token=${member.inviteCode}`;
    navigator.clipboard.writeText(link).then(() => {
      toast({ title: "Link Copied", description: "Invite link copied to clipboard." });
    }).catch(() => {
      toast({ title: "Copy Failed", description: "Could not access clipboard. Please copy manually.", variant: "destructive" });
    });
  }

  function handleRevokeInvite(member: TeamMember) {
    setConfirmDialog({
      open: true,
      title: "Revoke Invite",
      description: `Revoke the pending invite for ${member.email}? This cannot be undone.`,
      onConfirm: async () => {
        try {
          const res = await authDelete(`${BASE}/api/team/invites/${member.id}`);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error((body as { error?: string }).error ?? "Failed to revoke.");
          }
          await refreshTeam();
          toast({ title: "Invite Revoked", description: `The invitation for ${member.email} has been revoked.` });
        } catch (e: unknown) {
          toast({
            title: "Revoke Failed",
            description: e instanceof Error ? e.message : "Could not revoke the invite. Please try again.",
            variant: "destructive",
          });
        }
      },
    });
  }

  async function handleRoleUpdate(id: number, role: Role) {
    try {
      const res = await authPatch(`${BASE}/api/team/${id}`, { role });
      if (!res.ok) throw new Error("non-ok");
      await refreshTeam();
      toast({ title: "Role Updated", description: `Team member role changed to ${ROLE_LABELS[role]}.` });
    } catch {
      toast({ title: "Update Failed", description: "Could not update role. Please try again.", variant: "destructive" });
    } finally { setEditingId(null); }
  }

  function handleDelete(id: number) {
    if (currentUser?.id === id) {
      toast({ title: "Not Allowed", description: "You cannot remove yourself. Ask another admin to remove you.", variant: "destructive" });
      return;
    }
    setConfirmDialog({
      open: true,
      title: "Remove Team Member",
      description: "Are you sure you want to remove this team member? This action cannot be undone.",
      onConfirm: async () => {
        try {
          const res = await authDelete(`${BASE}/api/team/${id}`);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || "non-ok");
          }
          await refreshTeam();
          toast({ title: "Member Removed", description: "Team member has been removed." });
        } catch (err: any) {
          toast({ title: "Remove Failed", description: err.message || "Could not remove team member. Please try again.", variant: "destructive" });
        }
      },
    });
  }

  const filtered = search
    ? teamMembers.filter((m) =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.email.toLowerCase().includes(search.toLowerCase())
      )
    : teamMembers;

  const activeMembers = filtered.filter((m) => !m.invitePending);
  const pendingInvites = teamMembers.filter(
    (m) => m.invitePending && (
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase())
    ),
  );

  const allRows: Array<{ type: "member"; data: TeamMember } | { type: "pending"; data: TeamMember }> = [
    ...activeMembers.map((m) => ({ type: "member" as const, data: m })),
    ...pendingInvites.map((m) => ({ type: "pending" as const, data: m })),
  ];

  const TABS = [
    { id: "users" as const, label: "Users", icon: "group" },
    { id: "security" as const, label: "Security & Workflow", icon: "security" },
  ];

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="max-w-6xl mx-auto p-6 sm:p-12">

        <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-6 mb-10">
          <div className="space-y-1">
            <span className="text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
              Organization Settings
            </span>
            <h1 className="text-[2.5rem] sm:text-[3.5rem] font-bold tracking-tighter leading-[1.1] text-on-surface">
              Team &amp; Access
            </h1>
            <p className="text-on-surface-variant max-w-lg text-sm">
              Manage your organization's members, define operational roles, and set granular permission levels across the platform.
            </p>
          </div>
          <button
            onClick={() => { setInviteModalOpen(true); setActiveTab("users"); }}
            className="bg-primary-container hover:bg-primary-m3 text-white px-6 py-3 rounded-2xl flex items-center gap-2 font-semibold shadow-lg active:scale-95 transition-all shrink-0"
          >
            <span className="material-symbols-outlined text-[20px]">person_add</span>
            Invite Member
          </button>
        </div>

        <div className="flex items-center gap-1 mb-8 border-b border-outline-variant/15">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-primary-container text-primary-container"
                  : "border-transparent text-on-surface-variant hover:text-on-surface-variant",
              )}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "users" && (
          <div className="space-y-6">

            <div className="bg-white rounded-2xl overflow-hidden shadow-sm border ghost-border">
              <div className="px-6 sm:px-8 py-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b ghost-border">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-on-surface">Team Members</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">Active users and pending invitations</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setDrawerOpen(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary-container hover:text-primary-m3 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">info</span>
                    View Role Permissions
                  </button>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filter members..."
                      className="pl-9 pr-4 py-2 text-sm bg-surface rounded-2xl border ghost-border focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/30 w-56 placeholder:text-on-surface-variant outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="divide-y divide-[rgba(200,197,203,0.08)]">
                {allRows.length === 0 ? (
                  <div className="px-8 py-16 text-center">
                    <span className="material-symbols-outlined text-4xl text-surface-container-highest mb-3 block">group</span>
                    <p className="text-sm font-medium text-on-surface-variant">
                      {search ? "No members match your search" : "No team members yet"}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {search ? "Try a different filter" : "Add a team member to get started"}
                    </p>
                  </div>
                ) : (
                  allRows.map((row, idx) => {
                    if (row.type === "pending") {
                      const p = row.data;
                      const pendingRole = p.role as Role;
                      return (
                        <div key={`pending-${p.id}`} className="px-6 sm:px-8 py-5 flex items-center justify-between hover:bg-amber-50/40 transition-colors border-l-2 border-amber-300/60">
                          <div className="flex items-center gap-4">
                            <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center text-amber-500">
                              <span className="material-symbols-outlined text-[20px]">schedule_send</span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-semibold text-sm text-on-surface">{p.name}</h4>
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                  Pending
                                </span>
                              </div>
                              <p className="text-xs text-on-surface-variant mt-0.5">
                                {p.email} · Invited as {ROLE_LABELS[pendingRole]}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="hidden sm:block">
                              <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-2xl", ROLE_BADGE_COLORS[pendingRole])}>
                                {ROLE_LABELS[pendingRole]}
                              </span>
                            </div>
                            <RowDropdown
                              isPending
                              onCopy={() => handleCopyInviteLink(p)}
                              onRevoke={() => handleRevokeInvite(p)}
                            />
                          </div>
                        </div>
                      );
                    }

                    const m = row.data;
                    const isYou = currentUser?.id === m.id;
                    const memberRole = m.role as Role;
                    const canApprove = CAN_APPROVE.includes(memberRole);

                    return (
                      <div
                        key={m.id}
                        className="px-6 sm:px-8 py-5 flex items-center justify-between hover:bg-surface/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 rounded-full bg-primary-container/10 flex items-center justify-center text-primary-container font-bold text-sm shrink-0">
                            {getInitials(m.name)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-sm text-on-surface">{m.name}</h4>
                              {isYou && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-container/10 text-primary-container">
                                  You
                                </span>
                              )}
                              {/* Governance approval badge */}
                              <span className={cn(
                                "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                                canApprove
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200",
                              )}>
                                {canApprove ? "Can Approve" : "Propose Only"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <p className="text-xs text-on-surface-variant">{m.email}</p>
                              {/* Workspace scope */}
                              <span className="flex items-center gap-1 text-[10px] text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
                                <span className="material-symbols-outlined text-[11px]">
                                  {m.workspaceId == null ? "corporate_fare" : "domain"}
                                </span>
                                {getWorkspaceName(m.workspaceId)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 sm:gap-8">
                          <div className="hidden sm:block">
                            {editingId === m.id ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={editRole}
                                  onChange={(e) => setEditRole(e.target.value as Role)}
                                  className="bg-surface border border-outline-variant/15 rounded-2xl px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container/20"
                                >
                                  {ROLES.map((r) => (
                                    <option key={r} value={r}>{GOVERNANCE_ALIAS[r]} ({ROLE_LABELS[r]})</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleRoleUpdate(m.id, editRole)}
                                  className="w-8 h-8 flex items-center justify-center rounded-2xl bg-primary-container text-white hover:bg-primary-m3 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[18px]">check</span>
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="w-8 h-8 flex items-center justify-center rounded-2xl hover:bg-surface-container-low text-on-surface-variant transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                              </div>
                            ) : (
                              <div className="text-right">
                                <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-2xl block", ROLE_BADGE_COLORS[memberRole] || ROLE_BADGE_COLORS.viewer)}>
                                  {GOVERNANCE_ALIAS[memberRole] || ROLE_LABELS[memberRole] || m.role}
                                </span>
                                <span className="text-[10px] text-on-surface-variant mt-0.5 block">{ROLE_LABELS[memberRole]}</span>
                              </div>
                            )}
                          </div>
                          <div className="hidden md:block text-right min-w-[80px]">
                            {isYou ? (
                              <span className="text-xs font-medium text-emerald-600 flex items-center gap-1 justify-end">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Active Now
                              </span>
                            ) : (
                              <span className="text-xs text-on-surface-variant">
                                Joined {getTimeSince(m.createdAt)}
                              </span>
                            )}
                          </div>
                          {editingId !== m.id && (
                            <RowDropdown
                              onEdit={() => { setEditingId(m.id); setEditRole(memberRole); }}
                              onDelete={isYou ? undefined : () => handleDelete(m.id)}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {allRows.length > 0 && (
                <div className="px-6 sm:px-8 py-4 bg-surface/50 border-t ghost-border flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant font-medium">
                    {filtered.length} member{filtered.length !== 1 ? "s" : ""}{pendingInvites.length > 0 ? ` · ${pendingInvites.length} pending` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "security" && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-2xl p-8 shadow-sm border ghost-border space-y-6">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-on-surface mb-1">Security & Workflow Policies</h2>
                <p className="text-xs text-on-surface-variant">Configure approval flows and audit controls for your organization.</p>
              </div>

              <div className="flex items-start gap-4 p-5 rounded-2xl bg-surface">
                <div className="w-10 h-10 rounded-2xl bg-primary-container/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px] text-primary-container">gavel</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm mb-1 text-on-surface">Dual-Authorization Requirement</h4>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Changes to high-priority campaigns require approval from at least two Account Directors or Agency Principals.
                  </p>
                </div>
                <div className="ml-4 shrink-0 pt-1">
                  <IOSSwitch on={dualAuth} onToggle={() => setDualAuth((v) => !v)} />
                </div>
              </div>

              <div className="flex items-start gap-4 p-5 rounded-2xl bg-surface">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px] text-emerald-600">verified_user</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm mb-1 text-on-surface">Strict Audit Locking</h4>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Automated locking of datasets once a final audit has been signed off by an Agency Principal tier user.
                  </p>
                </div>
                <div className="ml-4 shrink-0 pt-1">
                  <IOSSwitch on={auditLock} onToggle={() => setAuditLock((v) => !v)} />
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Invite Member modal */}
      {inviteModalOpen && (
        <InviteModal
          onClose={() => setInviteModalOpen(false)}
          onSuccess={() => refreshTeam()}
        />
      )}

      <RolePermissionsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => { if (!open) setConfirmDialog((prev) => ({ ...prev, open: false })); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmDialog.onConfirm(); setConfirmDialog((prev) => ({ ...prev, open: false })); }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
