import type React from "react";
import { Navigate } from "react-router-dom";
import { getToken } from "../api";

export function Protected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
