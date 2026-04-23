import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface TooltipDefProps {
  text: string;
  children: React.ReactNode;
  className?: string;
}

export function TooltipDef({ text, children, className }: TooltipDefProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setCoords({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    }
    setVisible(true);
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        className={cn(
          "border-b border-dashed border-outline cursor-help text-inherit",
          className,
        )}
      >
        {children}
      </span>

      {visible && (
        <div
          className="fixed z-[9998] pointer-events-none"
          style={{
            left: coords.x,
            top: coords.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="bg-white border border-outline-variant/15 rounded-2xl px-3 py-2 shadow-2xl max-w-[220px] text-center">
            <p className="text-xs text-on-surface leading-relaxed font-sans">{text}</p>
          </div>
          {/* Arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0"
            style={{
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "5px solid rgb(63 63 70)",
            }}
          />
        </div>
      )}
    </>
  );
}
