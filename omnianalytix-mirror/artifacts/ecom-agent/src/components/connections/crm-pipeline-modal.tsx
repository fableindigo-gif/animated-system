import { useState } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_STAGES = [
  "Marketing Qualified Lead (MQL)",
  "Sales Qualified Lead (SQL)",
  "Opportunity Created",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
];

const CONVERSION_ACTIONS = [
  "Lead Form Submit",
  "Phone Call",
  "Request Quote",
  "Demo Booked",
  "Free Trial Started",
  "Purchase / Revenue",
  "Custom Conversion",
];

interface CrmPipelineMappingModalProps {
  open: boolean;
  onClose: () => void;
  crmPlatform: string;
}

export function CrmPipelineMappingModal({ open, onClose, crmPlatform }: CrmPipelineMappingModalProps) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      localStorage.setItem("omni_crm_pipeline_mapping", JSON.stringify({ platform: crmPlatform, mapping }));
      setSaving(false);
      setSaved(true);
      setTimeout(() => onClose(), 800);
    }, 600);
  };

  if (!open) return null;

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-4 border-b ghost-border">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-violet-600 text-xl">account_tree</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-on-surface">Pipeline Stage Mapping</h2>
              <p className="text-[11px] text-on-surface-variant mt-0.5">{crmPlatform} → Google Ads Conversion Actions</p>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
            Map each CRM lead stage to a Google Ads conversion action. This enables offline conversion tracking and ROAS optimization.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {DEFAULT_STAGES.map((stage) => (
            <div key={stage} className="p-3.5 bg-surface rounded-2xl border ghost-border">
              <p className="text-[11px] font-bold text-on-surface-variant mb-2">{stage}</p>
              <select
                value={mapping[stage] || ""}
                onChange={(e) => setMapping((prev) => ({ ...prev, [stage]: e.target.value }))}
                className="w-full text-xs bg-white border border-outline-variant/15 rounded-2xl px-3 py-2.5 focus:ring-2 focus:ring-primary-container/20 focus:border-primary-container/40 outline-none transition-all appearance-none cursor-pointer"
              >
                <option value="">— Select conversion action —</option>
                {CONVERSION_ACTIONS.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="p-6 pt-4 border-t ghost-border flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || mappedCount === 0}
            className={cn(
              "flex-1 py-3 text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2",
              saved
                ? "bg-emerald-500 text-white"
                : "bg-primary-container hover:bg-primary-m3 text-white disabled:opacity-50",
            )}
          >
            {saved ? (
              <><span className="material-symbols-outlined text-sm">check_circle</span> Saved</>
            ) : saving ? (
              <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span> Saving…</>
            ) : (
              <><span className="material-symbols-outlined text-sm">save</span> Save Mapping ({mappedCount}/{DEFAULT_STAGES.length})</>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 border border-outline-variant/15 text-xs text-on-surface-variant font-medium rounded-2xl hover:bg-surface transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
