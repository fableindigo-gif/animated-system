import { Loader2 } from "lucide-react";

interface SkeletonLoaderProps {
  message?: string;
  pct?: number;
}

export default function SkeletonLoader({ message, pct }: SkeletonLoaderProps) {
  return (
    <div className="grid grid-cols-12 gap-3 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="col-span-12 sm:col-span-6 lg:col-span-4 h-32 rounded-2xl bg-surface-container-low border border-outline-variant/30 animate-pulse"
        />
      ))}
      <div className="col-span-12 mt-4 flex items-center justify-center gap-3 text-on-surface-variant">
        <Loader2 className="w-4 h-4 animate-spin" />
        <div className="text-xs">
          <div className="font-semibold">{message ?? "Hydrating analytics warehouse…"}</div>
          {typeof pct === "number" && pct > 0 && (
            <div className="text-[10px] opacity-60">{Math.round(pct)}% complete · this can take 2-5 minutes on first sync</div>
          )}
        </div>
      </div>
    </div>
  );
}
