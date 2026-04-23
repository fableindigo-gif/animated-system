import { useState } from "react";
import { Loader2, Target } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useEconomicsSettings } from "@/lib/use-economics-settings";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

/**
 * "Set your targets while we sync" — a small form rendered on Home only when
 * the warehouse is in its first hydration window (HISTORICAL_BACKFILL or
 * SYNCING) AND the tenant has not configured COGS % or target ROAS yet.
 *
 * This turns the otherwise dead 5–15 minute first-sync wait into productive
 * configuration time so that when the dashboard hydrates, every POAS / True
 * Profit / Health badge is computed against the agency's actual targets
 * instead of the platform default. Saves a round-trip back into Settings.
 */
export function SetTargetsWaitForm() {
  const { settings, refresh } = useEconomicsSettings();
  const { toast } = useToast();

  const cogsPctConfigured   = settings?.cogsPct    != null;
  const targetRoasConfigured = settings?.targetRoas != null;
  const alreadyConfigured   = cogsPctConfigured && targetRoasConfigured;

  const [cogsPctInput,   setCogsPctInput]   = useState<string>(() => cogsPctConfigured   ? String(Math.round((settings!.cogsPct as number) * 100)) : "");
  const [targetRoasInput, setTargetRoasInput] = useState<string>(() => targetRoasConfigured ? String(settings!.targetRoas) : "");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  if (alreadyConfigured) return null;

  const handleSave = async () => {
    const cogsPct = cogsPctInput.trim() === "" ? null : Number(cogsPctInput) / 100;
    const targetRoas = targetRoasInput.trim() === "" ? null : Number(targetRoasInput);

    if (cogsPct != null && (Number.isNaN(cogsPct) || cogsPct < 0 || cogsPct > 1)) {
      toast({ title: "COGS % must be between 0 and 100", variant: "destructive" });
      return;
    }
    if (targetRoas != null && (Number.isNaN(targetRoas) || targetRoas <= 0)) {
      toast({ title: "Target ROAS must be a positive number", variant: "destructive" });
      return;
    }
    if (cogsPct == null && targetRoas == null) {
      toast({ title: "Enter at least one target to save", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}api/settings/economics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cogsPct    != null ? { cogsPct }    : {}),
          ...(targetRoas != null ? { targetRoas } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
      setSaved(true);
      toast({ title: "Targets saved — they'll apply as soon as the sync finishes." });
    } catch (err) {
      toast({
        title: "Could not save targets",
        description: err instanceof Error ? err.message : "Network error.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="set-targets-wait-form"
      className="px-4 py-3 border-b border-amber-300/30 bg-amber-50/60 shrink-0"
    >
      <div className="max-w-4xl mx-auto flex items-start gap-4">
        <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
          <Target className="w-4 h-4 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface">
            {saved ? "Targets saved — applied to every KPI when the sync finishes." : "Set your targets while we sync"}
          </p>
          {!saved && (
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              First sync usually takes 5–15 minutes. Use this time to tell us what "good" looks like for this client — we'll wire these into POAS, True Profit, and the Health badge automatically.
            </p>
          )}
          {!saved && (
            <div className="flex flex-wrap items-end gap-3 mt-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">COGS %</span>
                <div className="flex items-center">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="35"
                    value={cogsPctInput}
                    onChange={(e) => setCogsPctInput(e.target.value)}
                    className="w-20 px-2 py-1.5 text-xs border border-outline-variant/40 rounded-l-lg outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 bg-white text-on-surface"
                    aria-label="Cost of goods sold percentage"
                  />
                  <span className="px-2 py-1.5 text-xs font-semibold text-on-surface-variant border border-l-0 border-outline-variant/40 rounded-r-lg bg-surface-container-low">
                    %
                  </span>
                </div>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">Target ROAS</span>
                <div className="flex items-center">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.1}
                    placeholder="3.0"
                    value={targetRoasInput}
                    onChange={(e) => setTargetRoasInput(e.target.value)}
                    className="w-20 px-2 py-1.5 text-xs border border-outline-variant/40 rounded-l-lg outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 bg-white text-on-surface"
                    aria-label="Target return on ad spend"
                  />
                  <span className="px-2 py-1.5 text-xs font-semibold text-on-surface-variant border border-l-0 border-outline-variant/40 rounded-r-lg bg-surface-container-low">
                    ×
                  </span>
                </div>
              </label>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="h-[34px] px-4 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors"
                data-testid="set-targets-save"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Save targets
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
