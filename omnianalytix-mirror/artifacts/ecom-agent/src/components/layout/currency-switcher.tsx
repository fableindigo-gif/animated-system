import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import {
  getCurrencySymbol,
  listSupportedCurrencies,
  useCurrency,
} from "@/contexts/currency-context";

/**
 * Header-mounted currency switcher.
 *
 * Behavior:
 *  - "Auto" → follow the auto-detect chain (override = null).
 *  - Picking a code stores it in localStorage and persists across tabs.
 *  - Auto-detected currencies (from connected accounts) are pinned to the
 *    top of the menu and badged so the user knows where they came from.
 *
 * Honesty: this only relabels values rendered through `formatMoney` /
 * `currencySymbol`. Warehouse KPIs continue to render through `formatUsd`
 * (always `$`) until a forex pipeline is wired — the menu surfaces a
 * one-line caption explaining this so users don't expect FX conversion.
 */
export function CurrencySwitcher() {
  const {
    currencyCode,
    currencySymbol,
    currencySource,
    detectedCurrencies,
    displayOverride,
    setDisplayOverride,
  } = useCurrency();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside dismisses the menu.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const all = listSupportedCurrencies();
  // Promote detected currencies to the top of the list.
  const detectedSet = new Set(detectedCurrencies);
  const ordered = [
    ...all.filter((c) => detectedSet.has(c.code)),
    ...all.filter((c) => !detectedSet.has(c.code)),
  ];

  const sourceLabel = (() => {
    switch (currencySource) {
      case "override":       return "Manual override";
      case "auto-account":   return "Detected from connected account";
      case "auto-workspace": return "From workspace HQ";
      case "fallback":       return "Default (no account currency yet)";
    }
  })();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-slate-200/80 bg-white/70 hover:bg-slate-50 transition-colors text-xs font-medium text-slate-700"
        title={`Display currency · ${sourceLabel}`}
        aria-label="Change display currency"
        data-testid="currency-switcher-trigger"
      >
        <span className="font-mono text-slate-500">{currencySymbol}</span>
        <span className="font-semibold tracking-tight">{currencyCode}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-150 shadow-2xl border border-slate-100">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Display currency</p>
            <p className="text-xs text-slate-500 mt-1 leading-snug">
              Affects manually-entered amounts. Warehouse KPIs stay in <span className="font-mono">USD</span> until forex sync ships.
            </p>
          </div>

          <button
            type="button"
            onClick={() => { setDisplayOverride(null); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors text-left"
            data-testid="currency-option-auto"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
            <span className="flex-1">
              <span className="font-medium text-slate-800">Auto-detect</span>
              <span className="block text-[11px] text-slate-500">
                {detectedCurrencies.length > 0
                  ? `From connected accounts: ${detectedCurrencies.join(", ")}`
                  : "Connect an account to enable detection"}
              </span>
            </span>
            {displayOverride === null && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
          </button>

          <div className="border-t border-slate-100 max-h-[280px] overflow-y-auto">
            {ordered.map(({ code, symbol }) => {
              const isDetected = detectedSet.has(code);
              const isActive   = displayOverride === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => { setDisplayOverride(code); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50 transition-colors text-left"
                  data-testid={`currency-option-${code}`}
                >
                  <span className="font-mono text-xs text-slate-400 w-5 text-right">{symbol}</span>
                  <span className="flex-1 font-medium text-slate-800">{code}</span>
                  {isDetected && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                      Detected
                    </span>
                  )}
                  {isActive && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Re-export so consumers can sanity-check codes without importing the lib. */
export { getCurrencySymbol };
