import { useState, useRef, useEffect } from "react";

interface PrerequisiteHintProps {
  text: string;
  inline?: boolean;
}

export function PrerequisiteHint({ text, inline = false }: PrerequisiteHintProps) {
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

  if (inline) {
    return (
      <p className="text-[11px] text-on-surface-variant leading-relaxed mt-1.5 flex items-start gap-1.5">
        <span className="material-symbols-outlined text-outline-variant shrink-0" style={{ fontSize: 13, marginTop: 1 }}>info</span>
        {text}
      </p>
    );
  }

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-outline-variant hover:text-on-surface-variant hover:bg-surface-container-low transition-colors"
        aria-label="Prerequisites"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-on-surface text-surface-container-low text-[11px] leading-relaxed rounded-2xl px-3.5 py-2.5 shadow-xl">
            {text}
          </div>
          <div className="w-2 h-2 bg-on-surface rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  );
}
