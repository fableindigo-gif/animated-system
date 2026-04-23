import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared error UI for failed react-query loads.
 *
 * Drop in wherever you'd otherwise render a permanent spinner on a silent
 * `catch {}`. Accepts the react-query `error` and a `refetch` function so
 * users always have a retry affordance instead of a stuck page.
 */
export function QueryErrorState({
  title = "Couldn't load this view",
  error,
  onRetry,
  className,
  compact = false,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Network error — please try again.";

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/40",
        compact ? "py-6 px-4" : "py-12 px-6",
        className,
      )}
    >
      <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
        <AlertTriangle className="w-5 h-5 text-rose-600" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-rose-900">{title}</p>
        <p className="text-xs text-rose-700/80 max-w-sm">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      )}
    </div>
  );
}
