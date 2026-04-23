import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = BASE + "/api/invite";
const SSO_START = BASE + "/api/auth/gate/sso/start";

const ROLE_LABELS: Record<string, string> = {
  admin:   "Agency Principal",
  manager: "Account Director",
  analyst: "Media Buyer",
  it:      "IT Architect",
  viewer:  "Client Viewer",
};

interface InviteInfo {
  memberId: number;
  name: string;
  email: string;
  role: string;
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

export default function JoinTeamPage() {
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("This invite link is invalid or has expired.");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setErrorMsg("No invite token found in this link.");
      setPhase("error");
      return;
    }
    setToken(t);
    fetch(`${API}/${encodeURIComponent(t)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Invalid invite.");
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
        throw new Error(body.error ?? "Could not accept invite.");
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#004ac6] flex items-center justify-center shadow-md">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 12L12 3L21 12V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V12Z" fill="white" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">OmniAnalytix</span>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
          {phase === "loading" && (
            <div className="p-10 flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
              <p className="text-sm text-slate-500">Verifying your invite…</p>
            </div>
          )}

          {phase === "error" && (
            <div className="p-10 flex flex-col items-center gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="#ef4444" />
                </svg>
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-lg mb-1">Invite Unavailable</h2>
                <p className="text-sm text-slate-500 leading-relaxed">{errorMsg}</p>
              </div>
              <button
                onClick={handleContinue}
                className="mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                Go to OmniAnalytix →
              </button>
            </div>
          )}

          {(phase === "ready" || phase === "accepting") && invite && (
            <>
              <div className="bg-gradient-to-r from-[#004ac6] to-indigo-500 px-8 pt-8 pb-6">
                <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="white" />
                  </svg>
                </div>
                <p className="text-white/75 text-sm font-medium mb-1">Welcome to the Team</p>
                <h1 className="text-white text-2xl font-bold leading-tight">
                  You've been invited
                </h1>
              </div>

              <div className="p-8">
                <div className="mb-6 rounded-2xl bg-slate-50 border border-slate-100 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Invited as</span>
                    <span className="text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full">
                      {ROLE_LABELS[invite.role] ?? invite.role}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Email</span>
                    <span className="text-sm font-medium text-slate-700">{invite.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Name</span>
                    <span className="text-sm font-medium text-slate-700">{invite.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Link expires</span>
                    <span className="text-xs text-slate-500">{formatExpiry(invite.expiresAt)}</span>
                  </div>
                </div>

                <p className="text-sm text-slate-500 leading-relaxed mb-6">
                  By accepting this invitation you'll join the agency platform as a{" "}
                  <strong className="text-slate-700">{ROLE_LABELS[invite.role] ?? invite.role}</strong>.
                  Click below to activate your account and sign in.
                </p>

                <button
                  onClick={handleAccept}
                  disabled={phase === "accepting"}
                  className="w-full py-3 rounded-2xl bg-[#004ac6] text-white font-semibold text-sm shadow-md hover:bg-[#003aaa] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {phase === "accepting" ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Activating…
                    </>
                  ) : (
                    "Accept Invitation & Sign In"
                  )}
                </button>

                <p className="text-center text-xs text-slate-400 mt-4">
                  This link can only be used once and expires in 48 hours.
                </p>
              </div>
            </>
          )}

          {phase === "done" && (
            <div className="p-10 flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#10b981" />
                </svg>
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-xl mb-1">Invite Accepted!</h2>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Your account is now active. Sign in with Google using{" "}
                  <strong className="text-slate-700">{invite?.email}</strong>{" "}
                  to access the platform.
                </p>
              </div>
              <button
                onClick={handleContinue}
                className="w-full py-3 rounded-2xl bg-[#004ac6] text-white font-semibold text-sm shadow-md hover:bg-[#003aaa] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" fillOpacity=".9"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity=".7"/>
                  <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" fill="#fff" fillOpacity=".5"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#fff" fillOpacity=".3"/>
                </svg>
                Sign In with Google →
              </button>
              <p className="text-xs text-slate-400">
                Make sure to sign in with <strong>{invite?.email}</strong>
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          OmniAnalytix · Secure invite-only access
        </p>
      </div>
    </div>
  );
}
