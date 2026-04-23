import { useMemo } from "react";
import { hasPermission, ROLE_RANK, type AppRole } from "@/lib/rbac-utils";

/**
 * useHasPermission
 * ----------------
 * Returns whether the currently authenticated user has at least the required role.
 *
 * @param requiredRole - The minimum role needed to perform the action.
 * @returns { permitted: boolean, userRole: AppRole }
 *
 * Usage:
 *   const { permitted } = useHasPermission("analyst");
 *   <button disabled={!permitted}>New Task</button>
 */
export function useHasPermission(requiredRole: AppRole): { permitted: boolean; userRole: AppRole } {
  return useMemo(() => {
    const raw      = (localStorage.getItem("omni_user_role") ?? "viewer").toLowerCase() as AppRole;
    const userRole = raw in ROLE_RANK ? raw : ("viewer" as AppRole);
    return { permitted: hasPermission(userRole, requiredRole), userRole };
  }, [requiredRole]);
}
