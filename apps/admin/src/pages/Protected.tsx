import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Button } from "antd";
import { Navigate } from "react-router-dom";
import {
  clearToken,
  getAdminIdentity,
  getToken,
  restoreAdminIdentity,
  subscribeAdminSession,
  type AdminIdentity
} from "../api";
import { AdminSessionProvider } from "../auth/session";

export function Protected({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AdminIdentity | null>(() => getAdminIdentity());
  const [loading, setLoading] = useState(() => Boolean(getToken()));
  const [error, setError] = useState<string | null>(null);

  const refreshIdentity = useCallback(async () => {
    if (!getToken()) {
      setIdentity(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await restoreAdminIdentity();
      setIdentity(next);
      return next;
    } catch (refreshError) {
      if (!getToken()) {
        setIdentity(null);
        return null;
      }
      setError(refreshError instanceof Error ? refreshError.message : "身份信息恢复失败");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => subscribeAdminSession(setIdentity), []);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  const context = useMemo(
    () => identity ? { identity, refreshIdentity } : null,
    [identity, refreshIdentity]
  );

  if (!getToken()) return <Navigate to="/login" replace />;
  if (loading) {
    return (
      <div aria-live="polite" style={{ display: "grid", minHeight: 240, placeItems: "center" }}>
        正在恢复登录状态
      </div>
    );
  }
  if (error || !identity) {
    return (
      <div className="protected-error">
        <Alert
          type="error"
          showIcon
          title="登录状态校验失败"
          description={error ?? "无法确认当前后台账户身份。"}
          action={
            <Button
              onClick={() => {
                clearToken();
                window.location.assign("/admin/login");
              }}
            >
              重新登录
            </Button>
          }
        />
      </div>
    );
  }
  return <AdminSessionProvider value={context!}>{children}</AdminSessionProvider>;
}
