import { useState, useRef, useEffect } from "react";
import { LifeBuoy, BookOpen, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

interface SupportFabProps {
  onOpenFaq: () => void;
}

export function SupportFab({ onOpenFaq }: SupportFabProps) {
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
    <div className="fixed right-6 z-[80] hidden lg:block lg:bottom-6" ref={ref}>
      {open && (
        <div className="absolute bottom-16 right-0 w-56 bg-white rounded-2xl shadow-xl border border-outline-variant/15/60 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="px-4 py-3 border-b ghost-border">
            <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider font-[system-ui]">
              Get Help
            </p>
          </div>
          <div className="py-1">
            <button
              onClick={() => { setOpen(false); onOpenFaq(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface transition-colors"
            >
              <BookOpen className="w-4 h-4 text-on-surface-variant" />
              <div>
                <p className="text-[13px] font-semibold text-on-surface-variant font-[system-ui]">Read Documentation</p>
                <p className="text-[10px] text-on-surface-variant font-[system-ui]">Browse FAQ & guides</p>
              </div>
            </button>
            <a
              href="mailto:support@omnianalytix.in"
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface transition-colors"
            >
              <Mail className="w-4 h-4 text-on-surface-variant" />
              <div>
                <p className="text-[13px] font-semibold text-on-surface-variant font-[system-ui]">Contact Support</p>
                <p className="text-[10px] text-on-surface-variant font-[system-ui]">support@omnianalytix.in</p>
              </div>
            </a>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-12 h-12 rounded-full bg-white shadow-lg border border-outline-variant/15/60 flex items-center justify-center transition-all duration-200 hover:shadow-xl hover:scale-105 active:scale-95",
          open && "ring-2 ring-accent-blue/20",
        )}
        aria-label="Support"
      >
        <LifeBuoy className={cn("w-5 h-5 transition-colors", open ? "text-accent-blue" : "text-on-surface-variant")} />
      </button>
    </div>
  );
}
