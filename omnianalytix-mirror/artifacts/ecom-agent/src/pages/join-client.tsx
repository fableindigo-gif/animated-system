import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = BASE + "/api/invite";
const SSO_START = BASE + "/api/auth/gate/sso/start";

interface InviteInfo {
  memberId: number;
  name: string;
  email: string;
  role: string;
  workspaceId: number | null;
  type: "team" | "client";
  expiresAt: string;
}

type Phase = "loading" | "ready" | "accepting" | "done" | "error";

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function JoinClientPage() {
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("This setup link is invalid or has expired.");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setErrorMsg("No setup token found in this link.");
      setPhase("error");
      return;
    }
    setToken(t);
    fetch(`${API}/${encodeURIComponent(t)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Invalid setup link.");
        }
        return res.json() as Promise<InviteInfo>;
      })
      .then((data) => {
        setInvite(data);
        setPhase("ready");
      })
      .catch((e: Error) => {
        setErrorMsg(e.message);
        setPhase("error");
      });
  }, []);

  async function handleAccept() {
    if (!token) return;
    setPhase("accepting");
    try {
      const res = await fetch(`${API}/${encodeURIComponent(token)}/consume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not activate your workspace access.");
      }
      setPhase("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function handleContinue() {
    window.location.href = SSO_START;
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] bg-gradient-to-b from-[#004ac6] to-indigo-800 flex-col justify-between p-10 relative overflow-hidden shrink-0">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-64 h-64 rounded-full bg-white/30 blur-3xl" />
          <div className="absolute bottom-20 right-10 w-48 h-48 rounded-full bg-indigo-300/40 blur-2xl" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2.5 mb-16">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 12L12 3L21 12V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V12Z" fill="white" />
              </svg>
            </div>
            <span className="text-white text-lg font-bold tracking-tight">OmniAnalytix</span>
          </div>
          <div className="space-y-8">
            <div>
              <h2 className="text-white text-3xl font-bold leading-snug mb-3">
                Your workspace<br />is ready.
              </h2>
              <p className="text-white/65 text-sm leading-relaxed">
                You've been given access to a dedicated analytics workspace. Activate your account to start viewing your performance data.
              </p>
            </div>
            <div className="space-y-4">
              {[
                { icon: "bar_chart", label: "Real-time performance dashboards" },
                { icon: "insights",  label: "AI-powered growth recommendations" },
                { icon: "lock",      label: "Your data is isolated and private" },
              ].map(({ icon, label }) => (
                <div key={icon} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-white text-[18px]">{icon}</span>
                  </div>
                  <span className="text-white/80 text-sm">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="relative text-white/40 text-xs">
          Secured by OmniAnalytix · Invite-only access
        </p>
      </div>

      <div className="flex-1 bg-white flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#004ac6] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 12L12 3L21 12V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V12Z" fill="white" />
              </svg>
            </div>
            <span className="font-bold text-slate-900">OmniAnalytix</span>
          </div>

          {phase === "loading" && (
            <div className="flex flex-col items-center gap-4 py-16">
              <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
              <p className="text-sm text-slate-500">Verifying your workspace access…</p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="#ef4444" />
                </svg>
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-xl mb-1">Link Unavailable</h2>
                <p className="text-sm text-slate-500 leading-relaxed">{errorMsg}</p>
                <p className="text-xs text-slate-400 mt-2">Please contact the agency for a new setup link.</p>
              </div>
              <button onClick={handleContinue} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                Go to OmniAnalytix →
              </button>
            </div>
          )}

          {(phase === "ready" || phase === "accepting") && invite && (
            <>
              <div className="mb-8">
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  Client Setup
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                  Welcome, {invite.name.split(" ")[0]}
                </h1>
                <p className="text-slate-500 text-sm leading-relaxed">
                  Your analytics workspace has been configured. Activate your account below to start viewing your dashboard.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 space-y-3.5 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Access Email</span>
                  <span className="text-sm text-slate-700 font-medium">{invite.email}</span>
                </div>
                <div className="border-t border-slate-100" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Access Level</span>
                  <span className="text-sm text-slate-700 font-medium">Dashboard Viewer</span>
                </div>
                <div className="border-t border-slate-100" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Link Expires</span>
                  <span className="text-xs text-slate-500">{formatExpiry(invite.expiresAt)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleAccept}
                  disabled={phase === "accepting"}
                  className="w-full py-3.5 rounded-2xl bg-[#004ac6] text-white font-semibold text-sm shadow-md hover:bg-[#003aaa] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {phase === "accepting" ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Activating your workspace…
                    </>
                  ) : (
                    <>
                      Activate My Workspace Access
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="white" />
                      </svg>
                    </>
                  )}
                </button>
                <p className="text-center text-xs text-slate-400">
                  This link is single-use and expires in 48 hours.
                </p>
              </div>
            </>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center gap-6 py-8 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#10b981" />
                </svg>
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-2xl mb-2">Workspace Activated</h2>
                <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                  Your access is confirmed. Sign in with{" "}
                  <strong className="text-slate-700">{invite?.email}</strong>{" "}
                  to open your analytics dashboard.
                </p>
              </div>
              <button
                onClick={handleContinue}
                className="w-full py-3.5 rounded-2xl bg-[#004ac6] text-white font-semibold text-sm shadow-md hover:bg-[#003aaa] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" fillOpacity=".9"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity=".7"/>
                  <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" fill="#fff" fillOpacity=".5"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#fff" fillOpacity=".3"/>
                </svg>
                Sign In with Google →
              </button>
              <p className="text-xs text-slate-400">Use <strong>{invite?.email}</strong> to sign in</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
