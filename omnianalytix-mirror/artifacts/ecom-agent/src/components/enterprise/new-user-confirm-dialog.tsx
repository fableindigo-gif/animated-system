import { useState } from "react";
import { Loader2, UserPlus, ArrowLeft, Zap, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface NewUserConfirmDialogProps {
  name: string;
  email: string;
  picture: string;
  setupKey: string;
  onConfirmed: (data: {
    token: string;
    memberId: number;
    name: string;
    email: string;
    role: string;
    picture?: string | null;
  }) => void;
  onCancel: () => void;
}

export function NewUserConfirmDialog({
  name,
  email,
  picture,
  setupKey,
  onConfirmed,
  onCancel,
}: NewUserConfirmDialogProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}api/auth/gate/sso/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupKey }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to create account");
      }

      const data = await res.json();
      onConfirmed({
        token: data.token,
        memberId: data.memberId,
        name: data.name,
        email: data.email,
        role: data.role,
        picture: data.picture,
      });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setCreating(false);
    }
  };

  const displayName = name || email.split("@")[0];
  const orgDomain = email.split("@")[1] ?? "";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0f]/70 backdrop-blur-md">
      <div className="w-full max-w-[420px] mx-4">
        <div className="bg-white rounded-3xl shadow-2xl border border-outline-variant/10 overflow-hidden">
          <div className="px-8 pt-8 pb-2 text-center">
            <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-accent-blue/10 border-2 border-accent-blue/20 flex items-center justify-center">
              {picture ? (
                <img
                  src={picture}
                  alt={`${name || email} profile picture`}
                  className="w-14 h-14 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <UserPlus className="w-7 h-7 text-accent-blue" aria-hidden="true" />
              )}
            </div>

            <h2 className="text-lg font-bold text-on-surface tracking-tight mb-1">
              Create your workspace?
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
              No account was found for this Google identity. Would you like to create a new OmniAnalytix workspace?
            </p>
          </div>

          <div className="mx-6 mb-5 rounded-2xl border border-outline-variant/15 bg-[#f8f9fb] p-4 space-y-3">
            <div className="flex items-center gap-3">
              {picture ? (
                <img
                  src={picture}
                  alt={`${displayName} profile picture`}
                  className="w-10 h-10 rounded-full object-cover border border-outline-variant/15"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-accent-blue/15 flex items-center justify-center text-accent-blue text-sm font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-on-surface truncate">{displayName}</p>
                <p className="text-xs text-on-surface-variant font-mono truncate">{email}</p>
              </div>
            </div>

            <div className="border-t border-outline-variant/10 pt-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                <Zap className="w-3.5 h-3.5 text-accent-blue shrink-0" />
                <span>
                  Workspace: <span className="font-semibold text-on-surface">{orgDomain}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Role: Admin (first member gets full access)</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-4 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          <div className="px-6 pb-6 space-y-2.5">
            <button
              onClick={handleCreate}
              disabled={creating}
              className={cn(
                "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl text-sm font-bold transition-all",
                "bg-[#0081FB] hover:bg-[#0069d4] text-white shadow-lg shadow-[#0081FB]/20",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              {creating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating workspace...</>
              ) : (
                <><UserPlus className="w-4 h-4" /> Create Workspace &amp; Continue</>
              )}
            </button>

            <button
              onClick={onCancel}
              disabled={creating}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-[#f8f9fb] transition-all disabled:opacity-40"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>

          <div className="border-t border-outline-variant/10 px-6 py-3 bg-[#f8f9fb]">
            <p className="text-[10px] text-on-surface-variant text-center leading-relaxed font-mono">
              By creating a workspace you agree to our Terms of Service and Privacy Policy.
              Your data is encrypted and stored securely.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
