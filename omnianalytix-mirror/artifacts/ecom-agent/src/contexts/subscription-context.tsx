import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-fetch";

type Tier = "free" | "pro" | "enterprise" | "elite";

interface SubscriptionContextValue {
  tier: Tier;
  isPro: boolean;
  isElite: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  tier: "free",
  isPro: false,
  isElite: false,
  isLoading: true,
  refresh: async () => {},
});

const BASE = import.meta.env.BASE_URL ?? "/";
const API = BASE.endsWith("/") ? BASE : BASE + "/";

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [tier, setTier] = useState<Tier>("free");
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    try {
      const resp = await authFetch(`${API}api/organizations/subscription`);
      if (resp.ok) {
        const data = await resp.json() as { tier: Tier };
        setTier(data.tier ?? "free");
      }
    } catch (err) {
      console.error("[SubscriptionContext] Failed to load subscription:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const isElite = tier === "elite" || tier === "enterprise";

  useEffect(() => { void refresh(); }, []);

  return (
    <SubscriptionContext.Provider value={{ tier, isPro: tier !== "free", isElite, isLoading, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
