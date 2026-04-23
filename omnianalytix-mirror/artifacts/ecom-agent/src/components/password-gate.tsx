import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";
const TOKEN_KEY = "omnianalytix_gate_token";

async function verifyStoredToken(): Promise<{
  valid: boolean;
  authMethod?: string;
  memberId?: number;
  role?: string;
  name?: string;
  email?: string;
  organizationId?: number;
}> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return { valid: false };
  try {
    const res = await fetch(`${API_BASE}api/auth/gate/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { valid: false };
    const data = await res.json();
    return data;
  } catch {
    return { valid: false };
  }
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

function consumeSsoParams(): string | null {
  const params = new URLSearchParams(window.location.search);
  const ssoComplete = params.get("sso_complete");
  const ssoName = params.get("sso_name");
  const ssoEmail = params.get("sso_email");
  const ssoRole = params.get("sso_role");
  const ssoPicture = params.get("sso_picture");
  const ssoError = params.get("sso_error");

  if (ssoError) {
    params.delete("sso_error");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", clean);
    return null;
  }

  if (ssoComplete) {
    const cookieToken = getCookie("omni_sso_token");
    if (cookieToken) {
      localStorage.setItem(TOKEN_KEY, cookieToken);
      clearCookie("omni_sso_token");
    }

    if (ssoName) localStorage.setItem("omni_user_name", ssoName);
    if (ssoEmail) localStorage.setItem("omni_user_email", ssoEmail);
    if (ssoRole) localStorage.setItem("omni_user_role", ssoRole);
    if (ssoPicture) localStorage.setItem("omni_user_avatar", ssoPicture);

    params.delete("sso_complete");
    params.delete("sso_name");
    params.delete("sso_email");
    params.delete("sso_role");
    params.delete("sso_picture");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", clean);
    return cookieToken || localStorage.getItem(TOKEN_KEY);
  }

  return null;
}

export function AuthGate({ children, onUnauthenticated }: { children: React.ReactNode; onUnauthenticated?: () => void }) {
  const [status, setStatus] = useState<"loading" | "unauthenticated" | "authenticated">("loading");

  useEffect(() => {
    const ssoToken = consumeSsoParams();

    if (ssoToken) {
      setStatus("authenticated");
      return;
    }

    verifyStoredToken().then((result) => {
      if (result.valid) {
        if (result.name) localStorage.setItem("omni_user_name", result.name);
        if (result.email) localStorage.setItem("omni_user_email", result.email);
        if (result.role) localStorage.setItem("omni_user_role", result.role);
        if (result.memberId) localStorage.setItem("omni_current_user_id", String(result.memberId));
        setStatus("authenticated");
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setStatus("unauthenticated");
        onUnauthenticated?.();
      }
    });
  }, []);

  if (status === "loading") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-surface">
        <Loader2 className="w-6 h-6 animate-spin text-accent-blue" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return <>{children}</>;
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
