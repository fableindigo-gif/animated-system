import { useState, useRef, useEffect } from "react";

interface MetricTooltipProps {
  content: string;
}

export function MetricTooltip({ content }: MetricTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-outline-variant hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
        aria-label="Learn more about this metric"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>help</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-on-surface text-surface-container-low text-[11px] leading-relaxed rounded-2xl px-3.5 py-2.5 shadow-xl font-[system-ui]">
            {content}
          </div>
          <div className="w-2 h-2 bg-on-surface rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  );
}
