import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { setAuthTokenGetter, setCustomHeadersGetter } from "@workspace/api-client-react";
import { GlobalErrorBoundary } from "./components/layout/global-error-boundary";
import { captureException, initMonitoring } from "./lib/monitoring";
import App from "./App";
import "./index.css";

// ── Phase 1: Initialise Sentry before anything else renders ──────────────────
initMonitoring();

// ── Auth-alias intercept ─────────────────────────────────────────────────────
// `/login`, `/signup`, `/get-started` etc. are muscle-memory shortcuts for
// "sign me in" — not real destinations. When an unauthenticated user lands
// on one of them, bounce straight to the SSO start endpoint instead of
// showing the AuthRequiredPrompt quoting "/login" as a deep-link target
// (which is meaningless to the user). Runs before React mounts so the user
// never sees a flash of the landing page first.
const AUTH_ALIASES = new Set([
  "/login", "/signin", "/sign-in",
  "/signup", "/sign-up",
  "/register", "/get-started",
]);

function interceptAuthAliases(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem("omnianalytix_gate_token")) return false;
  const search = new URLSearchParams(window.location.search);
  if (search.get("sso_complete") || search.get("sso_token")) return false;

  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const path = window.location.pathname;
  const relative = (basePath ? path.replace(basePath, "") : path).replace(/\/+$/, "") || "/";
  if (!AUTH_ALIASES.has(relative)) return false;

  // Clear any stale return path so the user doesn't loop back to /login
  // after authenticating.
  sessionStorage.removeItem("omni_return_path");
  const apiBase = basePath ? `${basePath}/` : "/";
  window.location.replace(`${apiBase}api/auth/gate/sso/start`);
  return true;
}

if (interceptAuthAliases()) {
  // Stop the bundle here — the redirect above will navigate away. We don't
  // want React to mount and trigger any other side effects in the meantime.
  // Throwing keeps the JS engine from continuing past this point.
  throw new Error("auth-alias redirect in progress");
}

// ── API client wiring ─────────────────────────────────────────────────────────
setAuthTokenGetter(() => localStorage.getItem("omnianalytix_gate_token"));
setCustomHeadersGetter((): Record<string, string> => {
  const memberId = localStorage.getItem("omni_current_user_id");
  return memberId ? { "X-Team-Member-Id": memberId } : {};
});

// ── Global promise rejection handler ─────────────────────────────────────────
window.addEventListener("unhandledrejection", (event) => {
  if (import.meta.env.DEV) {
    console.error("[OmniAnalytix] Unhandled promise rejection:", event.reason);
  }
  captureException(event.reason, { extra: { type: "unhandledrejection" } });
});

// ── Render ────────────────────────────────────────────────────────────────────
// ── A11y: honour the user's `prefers-reduced-motion` OS setting ──────────────
// `reducedMotion="user"` makes every framer-motion component read the media
// query and skip non-essential transforms/opacity tweens when the user has
// asked their OS to reduce motion. This complements the global CSS rule in
// index.css that neutralises Tailwind `animate-*` keyframes. WCAG 2.3.3.
createRoot(document.getElementById("root")!).render(
  <GlobalErrorBoundary>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </GlobalErrorBoundary>
);
