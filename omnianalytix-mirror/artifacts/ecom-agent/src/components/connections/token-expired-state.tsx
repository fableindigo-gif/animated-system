import { ShieldAlert, RefreshCw } from "lucide-react";

interface TokenExpiredStateProps {
  platform: string;
  onReauthenticate: () => void;
}

export function TokenExpiredState({ platform, onReauthenticate }: TokenExpiredStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
      <div className="w-11 h-11 rounded-2xl bg-error-container border border-[rgba(255,180,171,0.2)] flex items-center justify-center">
        <ShieldAlert className="w-5 h-5 text-error-m3" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-error-m3">{platform} Session Expired</p>
        <p className="text-[11px] text-[#8890ad] font-mono leading-relaxed max-w-[220px]">
          Auth token expired. Re-authenticate to restore live data sync.
        </p>
      </div>
      <button
        onClick={onReauthenticate}
        className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-error-container border border-[rgba(255,180,171,0.25)] hover:bg-[rgba(255,180,171,0.16)] hover:border-[rgba(255,180,171,0.4)] text-error-m3 text-[11px] font-mono font-semibold transition-all"
      >
        <RefreshCw className="w-3 h-3" />
        Re-Authenticate
      </button>
    </div>
  );
}

// ─── Inline variant for use inside widget panels ───────────────────────────────

interface TokenExpiredInlineProps {
  platform: string;
  onReauthenticate: () => void;
}

export function TokenExpiredInline({ platform, onReauthenticate }: TokenExpiredInlineProps) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-[rgba(255,180,171,0.2)] bg-[rgba(255,180,171,0.05)]">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-error-m3 shrink-0" />
        <span className="text-[11px] text-error-m3 font-mono">
          {platform} token expired
        </span>
      </div>
      <button
        onClick={onReauthenticate}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-error-m3/20 hover:bg-[rgba(255,180,171,0.1)] text-error-m3 text-[10px] font-mono transition-all whitespace-nowrap"
      >
        <RefreshCw className="w-2.5 h-2.5" />
        Re-auth
      </button>
    </div>
  );
}
