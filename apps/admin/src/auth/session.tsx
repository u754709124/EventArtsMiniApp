import type React from "react";
import { createContext, useContext } from "react";
import type { AdminIdentity } from "../api";

export type AdminSessionContextValue = {
  identity: AdminIdentity;
  refreshIdentity: () => Promise<AdminIdentity | null>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function AdminSessionProvider({
  value,
  children
}: {
  value: AdminSessionContextValue;
  children: React.ReactNode;
}) {
  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) throw new Error("AdminSessionProvider is missing");
  return context;
}
