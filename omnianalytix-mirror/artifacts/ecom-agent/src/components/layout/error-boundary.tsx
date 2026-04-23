import { Component, type ReactNode } from "react";
import { trackEvent } from "@/lib/telemetry";
import { captureException } from "@/lib/monitoring";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
    trackEvent("error_boundary_caught", {
      label: this.props.fallbackLabel ?? "unknown",
      error: error.message?.slice(0, 200),
    });
    captureException(error, {
      componentStack: info.componentStack ?? undefined,
      extra: { boundary: "ErrorBoundary", label: this.props.fallbackLabel ?? "unknown" },
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      const label = this.props.fallbackLabel ?? "Unable to load widget";
      return (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface shadow-sm p-6 flex flex-col items-center justify-center gap-3 min-h-[120px] font-[system-ui]">
          <div className="w-10 h-10 rounded-2xl bg-error-container flex items-center justify-center">
            <span className="material-symbols-outlined text-on-error-container" style={{ fontSize: 20 }}>
              error_outline
            </span>
          </div>
          <p className="text-sm font-semibold text-on-surface-variant text-center">{label}</p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-xs font-bold text-surface bg-on-surface hover:bg-on-surface/90 rounded-2xl transition-colors active:scale-95"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
