import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-fetch";

export interface AccountConnection {
  id: number;
  platform: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  currency?: string;
}

interface AccountContextValue {
  accounts: AccountConnection[];
  activeAccount: AccountConnection | null;
  switchAccount: (id: number) => void;
  refreshAccounts: () => Promise<void>;
  isLoading: boolean;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  activeAccount: null,
  switchAccount: () => {},
  refreshAccounts: async () => {},
  isLoading: true,
});

const STORAGE_KEY = "omni_active_account_id";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountConnection[]>([]);
  const [activeId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });
  const [isLoading, setIsLoading] = useState(true);

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/connections`);
      if (!res.ok) return;
      const json = await res.json();
      const all: AccountConnection[] = Array.isArray(json) ? json : (json.data ?? json.connections ?? []);
      const active = all.filter((c) => c.isActive);
      const currencySource = active.find((c) => c.currency) ?? null;
      const enriched = active.map((c) => ({
        ...c,
        currency: c.currency || currencySource?.currency,
      }));
      setAccounts(enriched);
      if (enriched.length > 0) {
        const stored = localStorage.getItem(STORAGE_KEY);
        const storedId = stored ? parseInt(stored, 10) : null;
        const match = storedId ? enriched.find((a) => a.id === storedId) : null;
        if (!match) {
          setActiveId(enriched[0].id);
          localStorage.setItem(STORAGE_KEY, String(enriched[0].id));
        }
      }
    } catch (err) {
      console.error("[AccountContext] Failed to load accounts:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshAccounts(); }, [refreshAccounts]);

  const switchAccount = useCallback((id: number) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const activeAccount = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;

  return (
    <AccountContext.Provider value={{ accounts, activeAccount, switchAccount, refreshAccounts, isLoading }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
