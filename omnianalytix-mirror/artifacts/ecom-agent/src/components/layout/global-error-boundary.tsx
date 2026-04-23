import { Component, type ReactNode } from "react";
import { captureException } from "@/lib/monitoring";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Resolve active workspace from localStorage (boundary sits above WorkspaceProvider)
    const rawWsId    = localStorage.getItem("omni_active_workspace_id");
    const workspaceId = rawWsId ? Number(rawWsId) : null;

    // Phase 1: send to Sentry with workspace context + component stack
    captureException(error, {
      workspaceId,
      componentStack: info.componentStack ?? undefined,
      extra: { boundary: "GlobalErrorBoundary" },
    });

    if (import.meta.env.DEV) {
      console.error("[GlobalErrorBoundary] Application crash:", error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-6">
          <div className="w-full max-w-md text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500 mb-8">
              An unexpected error occurred. Please refresh the page to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-[#2563EB] text-white rounded-xl font-bold text-sm hover:bg-[#1e40af] transition-colors active:scale-95 shadow-lg shadow-blue-500/20"
            >
              Refresh Page
            </button>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="mt-6 text-left bg-slate-100 rounded-xl p-4">
                <summary className="text-xs font-bold text-slate-500 cursor-pointer">Error details</summary>
                <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                  {"\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
