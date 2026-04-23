import { X, ShieldAlert, ArrowRight } from "lucide-react";

const ERROR_MAP: Record<string, { title: string; message: string; suggestion: string }> = {
  access_denied: {
    title: "Access Denied",
    message: "You declined the authorization request. No data was shared.",
    suggestion: "Click the connect button again when you're ready to grant access.",
  },
  insufficient_permissions: {
    title: "Insufficient Permissions",
    message: "Your account doesn't have the required access level to authorize this connection.",
    suggestion: "Request Admin or Standard access from your account administrator, then try again.",
  },
  insufficient_scope: {
    title: "Missing Required Permissions",
    message: "Some required permissions were not granted during authorization.",
    suggestion: "Please re-authorize and accept all requested permissions to enable full functionality.",
  },
  token_exchange_failed: {
    title: "Authorization Failed",
    message: "We couldn't complete the secure handshake with the platform.",
    suggestion: "This is usually temporary. Please wait a moment and try connecting again.",
  },
  no_refresh_token: {
    title: "Session Token Missing",
    message: "The platform didn't return a long-lived access token. This can happen if you've connected before.",
    suggestion: "Revoke OmniAnalytix from your platform's connected apps, then re-authorize here.",
  },
  api_access_required: {
    title: "API Access Required",
    message: "Your platform plan may not include API access, which is needed for data synchronization.",
    suggestion: "Verify that your subscription plan includes API access, or upgrade if needed.",
  },
  owner_required: {
    title: "Owner Permission Required",
    message: "This connection requires Store Owner–level permissions to approve the requested scopes.",
    suggestion: "Ask the store owner to initiate the connection, or have them grant you collaborator access with the required permissions.",
  },
  internal_error: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred during the connection process.",
    suggestion: "Please try again. If the issue persists, contact support.",
  },
};

interface ConnectionFailedModalProps {
  platform: string;
  errorCode: string;
  onClose: () => void;
  onRetry: () => void;
}

export function ConnectionFailedModal({ platform, errorCode, onClose, onRetry }: ConnectionFailedModalProps) {
  const info = ERROR_MAP[errorCode] ?? ERROR_MAP.internal_error;

  const platformLabel =
    platform === "google_ads" ? "Google" :
    platform === "shopify" ? "Shopify" :
    platform === "meta" ? "Meta" :
    platform === "hubspot" ? "HubSpot" :
    platform === "salesforce" ? "Salesforce" :
    platform.charAt(0).toUpperCase() + platform.slice(1);

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm sm:px-4">
      <div className="bg-white rounded-t-lg sm:rounded-2xl shadow-2xl border border-outline-variant/15/60 max-w-sm w-full overflow-hidden animate-in fade-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[92dvh] sm:max-h-[85vh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-9 h-1 rounded-full bg-[#c8c5cb]" />
        </div>
        <div className="px-6 pt-5 sm:pt-7 pb-5 overflow-y-auto flex-1">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-error-container flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 text-error-m3" />
              </div>
              <div>
                <h3 className="text-base font-bold text-on-surface tracking-tight">
                  {info.title}
                </h3>
                <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mt-0.5">
                  {platformLabel} Connection
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-surface-container-low hover:bg-surface-container-highest flex items-center justify-center transition-colors -mt-1 -mr-1 min-w-[44px] min-h-[44px]"
            >
              <X className="w-3.5 h-3.5 text-on-surface-variant" />
            </button>
          </div>

          <p className="text-sm text-on-surface-variant leading-relaxed mb-3">
            {info.message}
          </p>

          <div className="bg-surface border ghost-border rounded-2xl px-4 py-3">
            <p className="text-[11px] text-on-surface-variant leading-relaxed flex items-start gap-2">
              <span className="material-symbols-outlined text-on-surface-variant shrink-0" style={{ fontSize: 14, marginTop: 1 }}>lightbulb</span>
              {info.suggestion}
            </p>
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-2.5 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}>
          <button
            onClick={onRetry}
            className="flex-1 py-2.5 bg-on-surface hover:bg-on-surface text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors active:scale-[0.98] min-h-[44px]"
          >
            Try Again
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 border border-outline-variant/15 text-on-surface-variant text-xs font-semibold rounded-2xl hover:bg-surface transition-colors min-h-[44px]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
