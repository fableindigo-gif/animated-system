import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── SideSheet ────────────────────────────────────────────────────────────────
// Reusable slide-out panel from the right edge of the screen.
// Keeps the main dashboard visible underneath.
//
// Usage:
//   <SideSheet open={open} onClose={() => setOpen(false)} title="Campaign Detail">
//     <p>Content goes here…</p>
//   </SideSheet>

interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  width?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const WIDTH_MAP = {
  sm: "w-80",
  md: "w-[420px]",
  lg: "w-[540px]",
  xl: "w-[680px]",
};

export function SideSheet({
  open,
  onClose,
  title,
  subtitle,
  width = "md",
  children,
  footer,
}: SideSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Escape key closes the sheet
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus trap — keep focus inside the sheet while open
  useEffect(() => {
    if (!open || !sheetRef.current) return;
    const el = sheetRef.current;
    const prev = document.activeElement as HTMLElement | null;
    el.focus();
    return () => { prev?.focus(); };
  }, [open]);

  // Prevent body scroll while sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet panel */}
          <motion.div
            key="sheet"
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex flex-col",
              "bg-white shadow-2xl outline-none",
              "border-l border-slate-200",
              WIDTH_MAP[width],
              "max-w-full",
            )}
          >
            {/* Header */}
            {(title || subtitle) && (
              <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-slate-100 shrink-0">
                <div className="min-w-0">
                  {title && (
                    <h2 className="text-base font-semibold text-slate-900 truncate" style={{ fontFamily: "'Manrope', sans-serif" }}>
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* No title — show close button inline */}
            {!title && !subtitle && (
              <div className="flex items-center justify-end px-4 pt-4 shrink-0">
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>

            {/* Optional footer */}
            {footer && (
              <div className="shrink-0 border-t border-slate-100 px-6 py-4 bg-slate-50">
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ─── SideSheetSection ─────────────────────────────────────────────────────────
// Styled section divider for use inside a SideSheet body.

export function SideSheetSection({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-5", className)}>
      {label && (
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

// ─── SideSheetRow ─────────────────────────────────────────────────────────────
// Label + value row inside a SideSheet section.

export function SideSheetRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: "primary" | "success" | "danger";
}) {
  const valueClass = cn(
    "text-sm font-semibold tabular-nums",
    accent === "primary" ? "text-omni-primary"
      : accent === "success" ? "text-emerald-600"
      : accent === "danger"  ? "text-red-500"
      : "text-slate-800",
  );
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={valueClass}>{value}</p>
    </div>
  );
}
