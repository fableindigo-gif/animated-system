import { AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { SiShopify, SiGoogle, SiMeta } from "react-icons/si";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Maps platform ID → re-auth URL or path
const REAUTH_MAP: Record<string, { label: string; href: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  shopify: {
    label: "Re-authorize Shopify",
    href: `${BASE}/connections`,
    icon: <SiShopify className="w-3.5 h-3.5" />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
  },
  google_ads: {
    label: "Re-authorize Google",
    href: `${BASE}/api/auth/google/start?platform=google_ads`,
    icon: <SiGoogle className="w-3.5 h-3.5" />,
    color: "text-[#60a5fa]",
    bg: "bg-primary-container/10",
    border: "border-primary-container/25",
  },
  gsc: {
    label: "Re-authorize Google",
    href: `${BASE}/api/auth/google/start?platform=gsc`,
    icon: <SiGoogle className="w-3.5 h-3.5" />,
    color: "text-[#60a5fa]",
    bg: "bg-primary-container/10",
    border: "border-primary-container/25",
  },
  meta: {
    label: "Re-authorize Meta",
    href: `${BASE}/connections`,
    icon: <SiMeta className="w-3.5 h-3.5" />,
    color: "text-[#60a5fa]",
    bg: "bg-primary-container/10",
    border: "border-primary-container/25",
  },
};

export interface ExpiredToken {
  platform: string;
  displayName?: string | null;
}

interface TokenExpiredStateProps {
  expiredTokens: ExpiredToken[];
  compact?: boolean;
}

export function TokenExpiredState({ expiredTokens, compact = false }: TokenExpiredStateProps) {
  if (expiredTokens.length === 0) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl border border-amber-400/20 bg-amber-400/5">
        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
        <span className="text-[10px] font-mono text-amber-400">
          {expiredTokens.length} token{expiredTokens.length > 1 ? "s" : ""} expired
        </span>
        <a
          href={`${BASE}/connections`}
          className="ml-auto text-[9px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors underline"
        >
          Fix →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-400/20 bg-[#0d1220] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-400/5 border-b border-amber-400/10">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-[11px] font-mono text-amber-400 font-semibold uppercase tracking-wider">
          Token Expired — Re-authorization Required
        </span>
      </div>

      <div className="p-4 space-y-2.5">
        <p className="text-[11px] font-mono text-on-surface-variant leading-relaxed">
          The following platform connections have expired or been revoked. Live data will be unavailable until re-authorized.
        </p>
        <div className="space-y-2">
          {expiredTokens.map((token) => {
            const meta = REAUTH_MAP[token.platform];
            const isOAuth = meta?.href?.includes("/start");
            return (
              <div
                key={token.platform}
                className={cn(
                  "flex items-center gap-3 p-2.5 rounded-2xl border",
                  meta ? cn(meta.bg, meta.border) : "bg-white/60 border-outline-variant/15",
                )}
              >
                <div className={cn(
                  "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
                  meta ? cn(meta.bg, meta.border, "border") : "bg-surface border-outline-variant/15 border",
                )}>
                  <span className={meta?.color ?? "text-on-surface-variant"}>{meta?.icon ?? <RefreshCw className="w-3 h-3" />}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-[11px] font-semibold", meta?.color ?? "text-on-surface-variant")}>
                    {token.displayName ?? token.platform}
                  </p>
                  <p className="text-[9px] font-mono text-on-surface-variant">Session token revoked · re-authorization required</p>
                </div>
                <a
                  href={meta?.href ?? `${BASE}/connections`}
                  target={isOAuth ? "_self" : undefined}
                  className={cn(
                    "shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-2xl border text-[10px] font-mono font-semibold transition-all",
                    meta
                      ? cn(meta.bg, meta.border, meta.color, "hover:opacity-80")
                      : "bg-surface border-outline-variant/15 text-on-surface-variant hover:border-outline",
                  )}
                >
                  <RefreshCw className="w-3 h-3" /> {meta?.label ?? "Re-authorize"}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
