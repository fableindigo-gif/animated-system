import type { ApiErrorBody, FieldErrors } from "@/types/shared";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function getGateToken(): string | null {
  return localStorage.getItem("omnianalytix_gate_token");
}

function getTeamMemberId(): string | null {
  return localStorage.getItem("omni_current_user_id");
}

export function getActiveWorkspaceId(): string | null {
  return localStorage.getItem("omni_active_workspace_id");
}

/**
 * Decode the bearer token (without signature verification — client-side only)
 * and extract the organizationId claim. Used to scope MCP `org_id` to the
 * authenticated user's organization rather than a hardcoded sentinel.
 */
export function getActiveOrgId(): string | null {
  const token = getGateToken();
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { organizationId?: number | string; orgId?: number | string };
    const org = payload.organizationId ?? payload.orgId;
    return org != null ? String(org) : null;
  } catch {
    return null;
  }
}

export interface AuthFetchOptions extends RequestInit {
  skipRbac?: boolean;
  skipWorkspace?: boolean;
}

export async function authFetch(
  path: string,
  options: AuthFetchOptions = {},
): Promise<Response> {
  const { skipRbac, skipWorkspace, headers: extraHeaders, ...rest } = options;
  const headers: Record<string, string> = {};

  const token = getGateToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  if (!skipRbac) {
    const memberId = getTeamMemberId();
    if (memberId) headers["X-Team-Member-Id"] = memberId;
  }

  // Inject active workspace ID into every request so backend RBAC can
  // scope data to the correct client workspace automatically.
  if (!skipWorkspace) {
    const wsId = getActiveWorkspaceId();
    if (wsId) headers["X-Workspace-Id"] = wsId;
  }

  if (extraHeaders) {
    const hObj =
      extraHeaders instanceof Headers
        ? Object.fromEntries(extraHeaders.entries())
        : Array.isArray(extraHeaders)
          ? Object.fromEntries(extraHeaders)
          : (extraHeaders as Record<string, string>);
    Object.assign(headers, hObj);
  }

  const url = path.startsWith("http") ? path : `${BASE}/${path.replace(/^\//, "")}`;

  const response = await fetch(url, { ...rest, headers });

  if (response.status === 401 || response.status === 403) {
    try {
      const clone = response.clone();
      const body = (await clone.json()) as ApiErrorBody;
      if (body?.code === "AUTH_REQUIRED" || body?.code === "RBAC_NO_IDENTITY") {
        localStorage.removeItem("omnianalytix_gate_token");
        localStorage.removeItem("omni_current_user_id");
        const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
        window.location.href = base || "/";
      }
    } catch {
      // couldn't parse body — don't redirect, let caller handle
    }
  }

  return response;
}

/**
 * parseApiError
 *
 * Call this after a non-2xx response to extract human-readable errors.
 * Returns a `FieldErrors` map (field → message) for 400 validation errors,
 * or a single `_root` key for generic failures.
 *
 * Usage in a form handler:
 *   const res = await authPost("/api/team/invite", payload);
 *   if (!res.ok) {
 *     const errs = await parseApiError(res);
 *     setEmailError(errs.email ?? "");
 *     setNameError(errs.name ?? "");
 *     if (errs._root) toast({ title: errs._root, variant: "destructive" });
 *     return;
 *   }
 */
export async function parseApiError(res: Response): Promise<FieldErrors> {
  const fieldErrors: FieldErrors = {};
  try {
    const body = (await res.clone().json()) as ApiErrorBody;

    // Backend returned structured per-field validation errors
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      for (const e of body.errors) {
        if (e.field && e.message) fieldErrors[e.field] = e.message;
      }
      return fieldErrors;
    }

    // Single generic error message
    const msg = body.error ?? body.message;
    if (msg) fieldErrors["_root"] = msg;
  } catch {
    fieldErrors["_root"] = `Request failed (${res.status})`;
  }
  return fieldErrors;
}

export async function authPost(
  path: string,
  body: unknown,
  options: AuthFetchOptions = {},
): Promise<Response> {
  return authFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    ...options,
    headers: { "Content-Type": "application/json", ...((options.headers as Record<string, string>) ?? {}) },
  });
}

export async function authPatch(
  path: string,
  body: unknown,
  options: AuthFetchOptions = {},
): Promise<Response> {
  return authFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
    ...options,
    headers: { "Content-Type": "application/json", ...((options.headers as Record<string, string>) ?? {}) },
  });
}

export async function authDelete(
  path: string,
  options: AuthFetchOptions = {},
): Promise<Response> {
  return authFetch(path, { method: "DELETE", ...options });
}
