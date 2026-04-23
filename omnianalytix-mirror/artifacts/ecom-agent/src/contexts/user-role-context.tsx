import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-fetch";

export type Role = "viewer" | "analyst" | "it" | "manager" | "admin";

export interface TeamMember {
  id: number;
  organizationId: number | null;
  workspaceId: number | null;
  name: string;
  email: string;
  role: Role;
  inviteCode: string;
  isActive: boolean;
  invitePending: boolean;
  createdAt: string;
}

export type ImpactLevel = "LOW" | "MEDIUM" | "HIGH";

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Client Viewer",
  analyst: "Media Buyer",
  it: "IT Architect",
  manager: "Account Director",
  admin: "Agency Principal",
};

export const ROLE_COLORS: Record<Role, string> = {
  viewer: "text-[#9e9da3] border-[#47464b] bg-[#1a1c1f]/60",
  analyst: "text-[#60a5fa] border-[#2563EB]/40 bg-[#2563EB]/10",
  it: "text-purple-400 border-purple-500/40 bg-purple-500/10",
  manager: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  admin: "text-cyan-400 border-cyan-500/40 bg-cyan-500/10",
};

export const IMPACT_COLORS: Record<ImpactLevel, string> = {
  LOW: "text-emerald-400 border-emerald-500/30 bg-emerald-500/8",
  MEDIUM: "text-amber-400 border-amber-500/30 bg-amber-500/8",
  HIGH: "text-rose-400 border-rose-500/30 bg-[#ffdad6]/8",
};

export const REQUIRED_ROLE_FOR_IMPACT: Record<ImpactLevel, Role> = {
  LOW: "analyst",
  MEDIUM: "manager",
  HIGH: "admin",
};

const ROLE_RANK: Record<Role, number> = { viewer: 0, analyst: 1, it: 1, manager: 2, admin: 3 };

export function canApproveImpact(role: Role, level: ImpactLevel): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[REQUIRED_ROLE_FOR_IMPACT[level]];
}

interface UserRoleContextValue {
  currentUser: TeamMember | null;
  setCurrentUser: (member: TeamMember | null) => void;
  teamMembers: TeamMember[];
  refreshTeam: () => Promise<void>;
  isLoading: boolean;
}

const UserRoleContext = createContext<UserRoleContextValue>({
  currentUser: null,
  setCurrentUser: () => {},
  teamMembers: [],
  refreshTeam: async () => {},
  isLoading: true,
});

const STORAGE_KEY = "omni_current_user_id";
const TOKEN_KEY = "omnianalytix_gate_token";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function assumeRole(memberId: number): Promise<string | null> {
  const currentToken = localStorage.getItem(TOKEN_KEY);
  if (!currentToken) return null;
  try {
    const res = await fetch(`${BASE}/api/auth/gate/assume-role`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentToken}`,
      },
      body: JSON.stringify({ memberId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token ?? null;
  } catch (err) {
    console.error("[UserRole] assumeRole failed:", err);
    return null;
  }
}

export function UserRoleProvider({ children }: { children: ReactNode }) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [currentUser, setCurrentUserState] = useState<TeamMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const bindMember = useCallback(async (member: TeamMember) => {
    setCurrentUserState(member);
    localStorage.setItem(STORAGE_KEY, String(member.id));
    const newToken = await assumeRole(member.id);
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
    }
  }, []);

  const refreshTeam = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/team`);
      if (!res.ok) return;
      const json = await res.json();
      const members: TeamMember[] = Array.isArray(json) ? json : (json.data ?? []);
      setTeamMembers(members);
      const storedId = localStorage.getItem(STORAGE_KEY);
      if (storedId) {
        const match = members.find((m) => m.id === parseInt(storedId, 10));
        if (match) {
          await bindMember(match);
          return;
        }
      }
      const admin = members.find((m) => m.role === "admin");
      if (admin) {
        await bindMember(admin);
      } else if (members.length > 0) {
        await bindMember(members[0]);
      }
    } catch (err) {
      console.error("[UserRoleContext] Failed to load team/role data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [bindMember]);

  useEffect(() => { refreshTeam(); }, [refreshTeam]);

  const setCurrentUser = useCallback((member: TeamMember | null) => {
    if (member) {
      bindMember(member);
    } else {
      setCurrentUserState(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [bindMember]);

  return (
    <UserRoleContext.Provider value={{ currentUser, setCurrentUser, teamMembers, refreshTeam, isLoading }}>
      {children}
    </UserRoleContext.Provider>
  );
}

export function useUserRole() {
  return useContext(UserRoleContext);
}
