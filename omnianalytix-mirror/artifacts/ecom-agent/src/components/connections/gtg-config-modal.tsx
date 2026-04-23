import { useState } from "react";
import { cn } from "@/lib/utils";

type InfraPath = "server_gtm" | "cdn" | null;

interface GtgConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: { infraPath: string; trackingDomain: string }) => void;
}

export function GtgConfigModal({ open, onClose, onSave }: GtgConfigModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [infraPath, setInfraPath] = useState<InfraPath>(null);
  const [trackingDomain, setTrackingDomain] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSave = () => {
    if (!infraPath || !trackingDomain.trim()) return;
    setSaving(true);
    setTimeout(() => {
      localStorage.setItem("omni_gtg_config", JSON.stringify({ infraPath, trackingDomain: trackingDomain.trim() }));
      onSave({ infraPath, trackingDomain: trackingDomain.trim() });
      setSaving(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-lg sm:rounded-2xl shadow-2xl w-full sm:max-w-md mx-0 sm:mx-4 animate-in slide-in-from-bottom sm:fade-in sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-[#4285F4]/10 border border-[#4285F4]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#4285F4] text-xl">sell</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-on-surface">GTG Integrity Monitor</h2>
              <p className="text-[11px] text-on-surface-variant mt-0.5">Configure Google Tag Gateway</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-5">
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold", step >= 1 ? "bg-primary-container text-white" : "bg-surface-container-low text-on-surface-variant")}>1</div>
            <div className={cn("flex-1 h-0.5 rounded-full", step >= 2 ? "bg-primary-container" : "bg-surface-container-highest")} />
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold", step >= 2 ? "bg-primary-container text-white" : "bg-surface-container-low text-on-surface-variant")}>2</div>
          </div>

          {step === 1 ? (
            <div className="space-y-3">
              <p className="text-xs text-on-surface-variant font-semibold mb-3">Select your infrastructure path:</p>
              <button
                onClick={() => { setInfraPath("server_gtm"); setStep(2); }}
                className={cn(
                  "w-full p-4 rounded-2xl border text-left transition-all",
                  infraPath === "server_gtm"
                    ? "border-[#93c5fd] bg-primary-container/10"
                    : "border-outline-variant/15 bg-surface hover:border-[#c8c5cb]",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary-container text-lg">dns</span>
                  <div>
                    <p className="text-sm font-bold text-on-surface">Server-side GTM</p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">Google Tag Manager server container</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => { setInfraPath("cdn"); setStep(2); }}
                className={cn(
                  "w-full p-4 rounded-2xl border text-left transition-all",
                  infraPath === "cdn"
                    ? "border-[#93c5fd] bg-primary-container/10"
                    : "border-outline-variant/15 bg-surface hover:border-[#c8c5cb]",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-amber-600 text-lg">cloud</span>
                  <div>
                    <p className="text-sm font-bold text-on-surface">CDN (Content Delivery Network)</p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">Cloudflare, Fastly, or custom CDN proxy</p>
                  </div>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-on-surface-variant font-semibold mb-1.5">Infrastructure</p>
                <div className="flex items-center gap-2 p-3 bg-primary-container/10 rounded-2xl border border-primary-container/20">
                  <span className="material-symbols-outlined text-primary-container text-sm">
                    {infraPath === "server_gtm" ? "dns" : "cloud"}
                  </span>
                  <span className="text-xs font-semibold text-primary-m3">
                    {infraPath === "server_gtm" ? "Server-side GTM" : "CDN"}
                  </span>
                  <button onClick={() => setStep(1)} className="ml-auto text-[10px] text-primary-container font-bold hover:text-primary-m3">Change</button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-on-surface-variant font-semibold mb-1.5">First-party tracking domain</label>
                <input
                  type="text"
                  value={trackingDomain}
                  onChange={(e) => setTrackingDomain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  placeholder="metrics.client-website.com"
                  className="w-full text-sm border border-outline-variant/15 rounded-2xl bg-surface px-4 py-3 focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/40 outline-none transition-all placeholder:text-on-surface-variant font-mono"
                />
                <p className="text-[10px] text-on-surface-variant mt-1.5">The custom subdomain that proxies tags to avoid ad-blocker interference.</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 pt-3 border-t ghost-border flex gap-3">
          {step === 2 && (
            <button
              onClick={handleSave}
              disabled={saving || !trackingDomain.trim()}
              className="flex-1 py-3 bg-primary-container hover:bg-primary-m3 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span> Activating…</>
              ) : (
                <><span className="material-symbols-outlined text-sm">check_circle</span> Activate GTG Monitor</>
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className={cn(
              "py-3 border border-outline-variant/15 text-xs text-on-surface-variant font-medium rounded-2xl hover:bg-surface transition-colors",
              step === 1 ? "flex-1" : "px-5",
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
