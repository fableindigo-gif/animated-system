import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListConnections } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

interface ConnectionsGuardProps {
  children: React.ReactNode;
}

const BYPASS_ROLES = ["super_admin", "admin", "agency_owner"];

const ALLOWED_PATHS = [
  "/",
  "/connections",
  "/privacy-policy",
  "/forensic",
  "/team",
  "/tasks",
  "/client-brief",
  "/resolution-base",
  "/capabilities",
  "/advanced-suite",
  "/billing-hub",
  "/settings",
  "/spreadsheets",
  "/data-modeling",
  "/docs",
  "/profile",
  "/admin/clients",
  "/agency/command-center",
  "/pipeline-funnel",
  "/sales-leaderboard",
  "/platform-admin",
];

export function ConnectionsGuard({ children }: ConnectionsGuardProps) {
  const { data: connections, isLoading } = useListConnections();
  const [location, setLocation] = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    const rawRole = (localStorage.getItem("omni_user_role") ?? "member").toLowerCase();
    const isBypassRole = BYPASS_ROLES.includes(rawRole);

    const activeCount = (connections ?? []).filter((c) => c.isActive).length;

    if (
      !isBypassRole &&
      activeCount === 0 &&
      !ALLOWED_PATHS.includes(location) &&
      !location.startsWith("/agency/")
    ) {
      setLocation("/");
    }

    setChecked(true);
  }, [connections, isLoading, location, setLocation]);

  if (isLoading && !checked) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-surface">
        <Loader2 className="w-6 h-6 animate-spin text-accent-blue" />
      </div>
    );
  }

  return <>{children}</>;
}
