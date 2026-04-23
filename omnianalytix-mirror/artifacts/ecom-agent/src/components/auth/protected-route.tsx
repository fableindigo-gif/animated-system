/**
 * ProtectedRoute
 * ---------------
 * Wraps a route so it is only accessible to users with one of the `allowedRoles`.
 * If the current user's role is not in that list they are immediately redirected
 * to the dashboard with an "Access Denied" toast.
 *
 * Usage in App.tsx:
 *   <Route path="/team">
 *     {() => (
 *       <ProtectedRoute allowedRoles={["admin"]}>
 *         <Team />
 *       </ProtectedRoute>
 *     )}
 *   </Route>
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export type AppRole =
  | "super_admin"
  | "admin"
  | "agency_owner"
  | "manager"
  | "analyst"
  | "it"
  | "viewer"
  | "member";

interface ProtectedRouteProps {
  allowedRoles: AppRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const rawRole = (localStorage.getItem("omni_user_role") ?? "member").toLowerCase() as AppRole;

  const isAllowed = allowedRoles.some((r) => r.toLowerCase() === rawRole);

  useEffect(() => {
    if (!isAllowed) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to view this page.",
        variant: "destructive",
      });
      navigate("/");
    }
  }, [isAllowed, navigate, toast]);

  if (!isAllowed) return null;

  return <>{children}</>;
}
