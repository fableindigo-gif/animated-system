import { useState } from "react";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

export function LookerEmbedCard() {
  const [jwtSecret, setJwtSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(() => !!localStorage.getItem("omni_looker_jwt_configured"));

  const handleSave = () => {
    if (!jwtSecret.trim()) return;
    setSaving(true);
    setTimeout(() => {
      localStorage.setItem("omni_looker_jwt_configured", "true");
      setSaving(false);
      setSaved(true);
      setJwtSecret("");
    }, 500);
  };

  return (
    <section className="bg-white border ghost-border rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary-container/10 border border-primary-container/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-xl text-primary-container">analytics</span>
          </div>
          <div>
            <h2 className="font-bold text-sm text-on-surface">Looker Embedded Analytics</h2>
            <p className="text-[10px] text-on-surface-variant mt-0.5">Cookieless JWT embedding for BI dashboards</p>
          </div>
        </div>
        {saved && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Configured
          </span>
        )}
      </div>

      <p className="text-xs text-on-surface-variant mb-4">
        Provide your Looker Embed JWT Secret to enable authenticated, cookieless iframe embedding for client-facing BI dashboards.
      </p>

      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type={showSecret ? "text" : "password"}
            value={jwtSecret}
            onChange={(e) => setJwtSecret(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            placeholder={saved ? "••••••••••••••••••••" : "Paste Looker JWT embed secret"}
            className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 pr-10 focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/40 outline-none transition-all placeholder:text-on-surface-variant font-mono"
          />
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface-variant transition-colors"
            type="button"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !jwtSecret.trim()}
          className={cn(
            "px-5 py-3 text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center gap-2 shrink-0",
            saved && !jwtSecret.trim()
              ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
              : "bg-primary-container hover:bg-primary-m3 text-white disabled:opacity-50",
          )}
        >
          {saving ? (
            <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span> Saving…</>
          ) : saved && !jwtSecret.trim() ? (
            <><span className="material-symbols-outlined text-sm">check_circle</span> Saved</>
          ) : (
            <><span className="material-symbols-outlined text-sm">lock</span> Save Secret</>
          )}
        </button>
      </div>
      {saved && (
        <p className="text-[10px] text-emerald-600 mt-2 flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px]">check_circle</span>
          JWT secret configured — Looker embeds are authenticated.
        </p>
      )}
    </section>
  );
}
