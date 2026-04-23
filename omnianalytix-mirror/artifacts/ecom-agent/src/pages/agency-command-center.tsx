import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useWorkspace, type Workspace } from "@/contexts/workspace-context";
import { WorkspaceProvisionWizard } from "@/components/enterprise/workspace-provision-wizard";
import { WorkspaceContextMenu } from "@/components/enterprise/workspace-context-menu";
import { authFetch } from "@/lib/auth-fetch";
import { queryKeys } from "@/lib/query-keys";
import { Building2, ChevronDown, ChevronRight as ChevronRightIcon } from "lucide-react";
import HandoffRegistry from "@/components/agency/HandoffRegistry";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OrgRow {
  id: number;
  name: string;
  slug: string;
  subscriptionTier: string | null;
  workspaceCount: number;
}

function statusMeta(status: string) {
  if (status === "active")  return { dot: "bg-emerald-500", label: "Active", color: "text-emerald-600" };
  if (status === "pending") return { dot: "bg-amber-400 animate-pulse", label: "Pending", color: "text-amber-600" };
  return                          { dot: "bg-on-surface-variant", label: "Archived", color: "text-on-surface-variant" };
}

function WorkspaceCard({
  ws,
  isActive,
  onSwitch,
}: {
  ws: Workspace;
  isActive: boolean;
  onSwitch: () => void;
}) {
  const { dot, label, color } = statusMeta(ws.status);
  const integrations = ws.enabledIntegrations as string[];
  const hasCritical = ws.criticalAlertCount > 0;

  return (
    <div
      className={cn(
        "relative bg-white border border-outline-variant/15 rounded-2xl p-4 shadow-sm flex flex-col gap-3 transition-all group hover:border-[#c8c5cb]",
        isActive && "border-brand-blue/30 ring-1 ring-brand-blue/10",
      )}
    >
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {isActive && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary-container/10 text-brand-blue text-[10px] font-bold border border-primary-container/20 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-pulse"></span>
            Active
          </div>
        )}

        {hasCritical && !isActive && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error-container text-error-m3 text-[10px] font-bold border border-error-m3/20 uppercase">
            <span className="material-symbols-outlined text-[14px]">warning</span>
            {ws.criticalAlertCount} critical
          </div>
        )}

        <WorkspaceContextMenu workspaceId={ws.id} workspaceName={ws.clientName} />
      </div>

      <div className="flex items-start gap-3">
        <div className={cn(
          "w-9 h-9 rounded-2xl flex items-center justify-center shrink-0",
          isActive ? "bg-primary-container/10 border border-primary-container/20" : "bg-surface-container-low border border-outline-variant/15",
        )}>
          <span className={cn(
            "material-symbols-outlined text-lg",
            isActive ? "text-brand-blue" : "text-on-surface-variant",
          )}>apartment</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate text-on-surface">{ws.clientName}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
            <span className={cn("text-[10px] font-medium", color)}>{label}</span>
            <span className="text-[10px] text-on-surface-variant">·</span>
            <span className="text-[10px] text-on-surface-variant truncate">{ws.slug}</span>
          </div>
        </div>
      </div>

      {integrations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {integrations.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border ghost-border text-[10px] font-medium text-on-surface-variant">
              {id.replace("_", " ")}
            </span>
          ))}
        </div>
      )}

      {ws.notes && (
        <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">{ws.notes}</p>
      )}

      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="text-[10px] text-on-surface-variant">
          {new Date(ws.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        <button
          onClick={onSwitch}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all",
            isActive
              ? "bg-primary-container/10 border border-primary-container/20 text-brand-blue"
              : "bg-surface-container-low border border-outline-variant/15 text-on-surface-variant hover:text-on-surface hover:border-[#c8c5cb]",
          )}
        >
          {isActive ? "Viewing" : "Switch"}
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
}

export default function AgencyCommandCenter() {
  const [, navigate] = useLocation();
  const { workspaces, activeWorkspace, switchWorkspace, isLoading } = useWorkspace();
  const [showWizard, setShowWizard] = useState(false);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<number>>(new Set());

  const orgsQuery = useQuery({
    queryKey: queryKeys.agencyOrganizations(),
    queryFn: async () => {
      const res = await authFetch(`${BASE}/api/admin/organizations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OrgRow[];
    },
  });
  const orgs = orgsQuery.data ?? [];

  // Default-expand each org once when the list first arrives.
  useEffect(() => {
    if (orgsQuery.data) {
      setExpandedOrgs((prev) => prev.size === 0 ? new Set(orgsQuery.data.map((o) => o.id)) : prev);
    }
  }, [orgsQuery.data]);

  const toggleOrg = (id: number) => setExpandedOrgs((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const totalCritical = workspaces.reduce((sum, ws) => sum + ws.criticalAlertCount, 0);
  const activeCount = workspaces.filter((w) => w.status === "active").length;
  const pendingCount = workspaces.filter((w) => w.status === "pending").length;

  const groupedWorkspaces = orgs.map((org) => ({
    org,
    workspaces: workspaces.filter((ws) => ws.organizationId === org.id),
  })).filter((g) => g.workspaces.length > 0);

  const ungroupedWorkspaces = workspaces.filter(
    (ws) => !orgs.some((o) => o.id === ws.organizationId),
  );

  const handleSwitch = (ws: Workspace) => {
    switchWorkspace(ws.id);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background text-on-surface pb-20">

      <main className="max-w-screen-md mx-auto px-4 py-6 space-y-6">

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-on-surface">Agency Overview</h2>
            <button
              onClick={() => setShowWizard(true)}
              className="bg-brand-blue text-white px-4 py-2.5 rounded-2xl text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Provision Client
            </button>
          </div>
        </section>

        <HandoffRegistry />

        <section className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 border border-outline-variant/15 rounded-2xl shadow-sm space-y-1">
            <p className="text-xs font-medium text-on-surface-variant">Active Workspaces</p>
            <p className="text-2xl font-bold text-on-surface">{activeCount}</p>
          </div>
          <div className="bg-white p-4 border border-outline-variant/15 rounded-2xl shadow-sm space-y-1">
            <p className="text-xs font-medium text-on-surface-variant">Pending</p>
            <p className="text-2xl font-bold text-on-surface-variant">{pendingCount > 0 ? pendingCount : "--"}</p>
          </div>
          <div className="bg-surface-container-low p-4 border border-outline-variant/15 rounded-2xl shadow-sm space-y-1 col-span-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">System Status</p>
              <p className="text-sm font-medium text-on-surface flex items-center gap-2 mt-1">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                Operational
              </p>
            </div>
            <div className="text-outline-variant">
              <span className="material-symbols-outlined text-[32px]">monitoring</span>
            </div>
          </div>
          <div className="bg-white p-4 border border-outline-variant/15 rounded-2xl shadow-sm space-y-1 col-span-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-on-surface-variant">Critical Alerts</p>
              {totalCritical === 0 ? (
                <span className="bg-surface-container-low text-on-surface-variant text-[10px] px-2 py-0.5 rounded-full font-bold">NONE</span>
              ) : (
                <span className="bg-error-container text-error-m3 text-[10px] px-2 py-0.5 rounded-full font-bold border border-error-m3/20">
                  {totalCritical} ALERT{totalCritical !== 1 ? "S" : ""}
                </span>
              )}
            </div>
            {totalCritical === 0 ? (
              <div className="flex items-center gap-3 mt-2 text-on-surface-variant italic text-sm">
                <span className="material-symbols-outlined text-[18px]">notifications_off</span>
                No active alerts requiring attention
              </div>
            ) : (
              <div className="flex items-center gap-3 mt-2 text-error-m3 text-sm font-medium">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                {totalCritical} critical alert{totalCritical !== 1 ? "s" : ""} detected — switch to affected workspace to resolve.
              </div>
            )}
          </div>
        </section>

        {isLoading ? (
          <section className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-2xl bg-white border border-outline-variant/15 animate-pulse" />
            ))}
          </section>
        ) : workspaces.length === 0 ? (
          <section className="bg-white border border-dashed border-[#c8c5cb] rounded-2xl min-h-[400px] flex flex-col items-center justify-center p-8 text-center space-y-6">
            <div className="relative">
              <div className="w-24 h-24 bg-surface rounded-full flex items-center justify-center border ghost-border">
                <span className="material-symbols-outlined text-5xl text-outline-variant">cloud_off</span>
              </div>
              <div className="absolute -bottom-2 -right-2 bg-white p-1 rounded-2xl border border-outline-variant/15">
                <span className="material-symbols-outlined text-on-surface-variant">search</span>
              </div>
            </div>
            <div className="space-y-2 max-w-xs">
              <h3 className="text-lg font-bold text-on-surface">No workspaces yet</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Kickstart your agency operations by provisioning your first client workspace. Once added, metrics will appear here.
              </p>
            </div>
            <button
              onClick={() => setShowWizard(true)}
              className="bg-brand-blue text-white px-8 py-3 rounded-2xl font-semibold flex items-center gap-2 hover:bg-primary-m3 active:scale-95 transition-all shadow-md"
            >
              Provision First Client
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">Client Workspaces</h3>
              <p className="text-xs text-on-surface-variant">{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</p>
            </div>

            {/* Hierarchical org → workspace display */}
            {groupedWorkspaces.map(({ org, workspaces: orgWs }) => (
              <div key={org.id} className="space-y-2">
                {/* Org header row */}
                <button
                  onClick={() => toggleOrg(org.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-low border border-outline-variant/15 hover:border-[#c8c5cb] transition-all group text-left"
                >
                  <Building2 className="w-4 h-4 text-primary-container shrink-0" />
                  <span className="text-xs font-bold text-on-surface flex-1">{org.name}</span>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full",
                    org.subscriptionTier === "pro" ? "bg-emerald-50 text-emerald-700" : "bg-surface text-on-surface-variant border border-outline-variant/15",
                  )}>
                    {org.subscriptionTier || "free"}
                  </span>
                  <span className="text-[10px] text-on-surface-variant">{orgWs.length} ws</span>
                  {expandedOrgs.has(org.id)
                    ? <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant" />
                    : <ChevronRightIcon className="w-3.5 h-3.5 text-on-surface-variant" />
                  }
                </button>

                {/* Workspace cards indented under org */}
                {expandedOrgs.has(org.id) && (
                  <div className="ml-4 pl-3 border-l-2 border-outline-variant/15 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {orgWs.map((ws) => (
                        <WorkspaceCard
                          key={ws.id}
                          ws={ws}
                          isActive={ws.id === activeWorkspace?.id}
                          onSwitch={() => handleSwitch(ws)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Ungrouped workspaces (fallback when orgs not fetched) */}
            {ungroupedWorkspaces.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ungroupedWorkspaces.map((ws) => (
                  <WorkspaceCard
                    key={ws.id}
                    ws={ws}
                    isActive={ws.id === activeWorkspace?.id}
                    onSwitch={() => handleSwitch(ws)}
                  />
                ))}
              </div>
            )}

            {/* Provision new */}
            <button
              onClick={() => setShowWizard(true)}
              className="w-full rounded-2xl border border-dashed border-[#c8c5cb] bg-surface/50 hover:border-brand-blue/30 hover:bg-primary-container/10/30 transition-all flex items-center justify-center gap-2 py-6 group"
            >
              <div className="w-8 h-8 rounded-xl bg-surface-container-low border border-outline-variant/15 flex items-center justify-center group-hover:border-brand-blue/30 group-hover:bg-primary-container/10 transition-all">
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-brand-blue transition-colors">add</span>
              </div>
              <p className="text-xs text-on-surface-variant group-hover:text-brand-blue transition-colors font-medium">Provision New Client</p>
            </button>
          </section>
        )}

      </main>

      {showWizard && (
        <WorkspaceProvisionWizard onClose={() => setShowWizard(false)} />
      )}
    </div>
  );
}
