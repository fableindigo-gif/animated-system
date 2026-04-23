import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-fetch";

const BASE     = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface CreditsState {
  credits:     number;
  hasAddon:    boolean;
  configured:  boolean;
  loading:     boolean;
  refresh:     () => Promise<void>;
}

const CreditsContext = createContext<CreditsState>({
  credits:    0,
  hasAddon:   false,
  configured: false,
  loading:    true,
  refresh:    async () => {},
});

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [credits,    setCredits]    = useState(0);
  const [hasAddon,   setHasAddon]   = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading,    setLoading]    = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}api/ai/creative/credits`);
      if (res.ok) {
        const data = await res.json() as { credits: number; hasAddon: boolean; configured: boolean };
        setCredits(data.credits ?? 0);
        setHasAddon(data.hasAddon ?? false);
        setConfigured(data.configured ?? false);
      }
    } catch {
      // Silent — credits just stay at 0 if the fetch fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("omnianalytix_gate_token");
    if (token) refresh();
  }, [refresh]);

  // Re-check after a credits_success redirect (Stripe payment complete)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("credits_success") === "true") {
      refresh();
      const clean = window.location.pathname + (params.toString().replace(/credits_success=true&?|&?credits_success=true/, "") ? `?${params}` : "");
      window.history.replaceState({}, "", clean);
    }
  }, [refresh]);

  return (
    <CreditsContext.Provider value={{ credits, hasAddon, configured, loading, refresh }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  return useContext(CreditsContext);
}
