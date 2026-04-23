import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import { toast } from "@/hooks/use-toast";
import type { Workspace } from "@/types/shared";

export type { Workspace };

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  authorizedWorkspaceIds: number[];
  switchWorkspace: (id: number) => void;
  refreshWorkspaces: () => Promise<void>;
  isLoading: boolean;
  justSwitched: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspace: null,
  authorizedWorkspaceIds: [],
  switchWorkspace: () => {},
  refreshWorkspaces: async () => {},
  isLoading: true,
  justSwitched: false,
});

const STORAGE_KEY = "omni_active_workspace_id";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [workspaces, setWorkspaces]     = useState<Workspace[]>([]);
  const [activeId, setActiveId]         = useState<number | null>(() => {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? parseInt(s, 10) : null;
  });
  const [isLoading, setIsLoading]       = useState(true);
  const [justSwitched, setJustSwitched] = useState(false);
  const switchTimerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/workspaces`);
      if (!res.ok) return;
      const all: Workspace[] = await res.json();
      const active = all.filter((w) => w.status !== "archived");
      setWorkspaces(active);

      if (active.length > 0) {
        const stored   = localStorage.getItem(STORAGE_KEY);
        const storedId = stored ? parseInt(stored, 10) : null;
        const match    = storedId ? active.find((w) => w.id === storedId) : null;
        if (!match) {
          setActiveId(active[0].id);
          localStorage.setItem(STORAGE_KEY, String(active[0].id));
        }
      }
    } catch (err) {
      console.error("[WorkspaceContext] Failed to load workspaces:", err);
      toast({
        title: "Could not load workspaces",
        description: "We couldn't reach the workspace service. Refresh the page to try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refreshWorkspaces(); }, [refreshWorkspaces]);

  const switchWorkspace = useCallback((id: number) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
    queryClient.removeQueries();
    setJustSwitched(true);
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => setJustSwitched(false), 2500);
  }, [queryClient]);

  const activeWorkspace       = workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null;
  const authorizedWorkspaceIds = workspaces.map((w) => w.id);

  return (
    <WorkspaceContext.Provider value={{ workspaces, activeWorkspace, authorizedWorkspaceIds, switchWorkspace, refreshWorkspaces, isLoading, justSwitched }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
