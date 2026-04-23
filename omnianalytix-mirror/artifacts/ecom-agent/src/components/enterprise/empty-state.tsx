import { cn } from "@/lib/utils";
import { type LucideIcon, Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title = "No Data Available",
  description = "Nothing to display yet. Data will appear here once available.",
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center gap-3 py-10 px-6 text-center select-none",
      className,
    )}>
      <div className="w-10 h-10 rounded-2xl bg-on-surface/60 border border-[#2C3E50]/40 flex items-center justify-center">
        <Icon className="w-5 h-5 text-on-surface-variant" />
      </div>
      <div className="space-y-1 max-w-[220px]">
        <p className="text-sm font-medium text-on-surface-variant">{title}</p>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
