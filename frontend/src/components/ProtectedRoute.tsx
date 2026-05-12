import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser, Role } from "../lib/auth";

interface ProtectedRouteProps {
  children: ReactNode;
  /** Si se pasan, solo esos roles pueden entrar */
  roles?: Role[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/tickets/nuevo" replace />;
  }
  return <>{children}</>;
}
