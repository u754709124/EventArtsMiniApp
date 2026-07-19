// @vitest-environment jsdom

import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminIdentity } from "../api";
import { AdminSessionProvider } from "../auth/session";
import { PermissionRoute } from "./AppRoutes";

function identity(overrides: Partial<AdminIdentity> = {}): AdminIdentity {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    username: "route-user",
    role: "USER",
    status: "enabled",
    permissions: ["change-password"],
    delegablePermissions: [],
    ...overrides
  };
}

function renderWithIdentity(current: AdminIdentity, children: ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AdminSessionProvider value={{ identity: current, refreshIdentity: vi.fn(async () => current) }}>
        {children}
      </AdminSessionProvider>
    </MemoryRouter>
  );
}

describe("admin route permission guard", () => {
  afterEach(() => cleanup());

  it("does not mount protected business content for unauthorized direct URLs", () => {
    const businessLoad = vi.fn();
    function BusinessPage() {
      useEffect(() => {
        businessLoad();
      }, []);
      return <div>业务页面</div>;
    }

    renderWithIdentity(identity(), (
      <PermissionRoute menuKey="backups">
        <BusinessPage />
      </PermissionRoute>
    ));

    expect(screen.getByText("无权访问")).toBeTruthy();
    expect(screen.queryByText("业务页面")).toBeNull();
    expect(businessLoad).not.toHaveBeenCalled();
  });

  it("mounts content when the current identity has the route menu key", () => {
    const businessLoad = vi.fn();
    function SelfServicePage() {
      useEffect(() => {
        businessLoad();
      }, []);
      return <div>修改密码页面</div>;
    }

    renderWithIdentity(identity(), (
      <PermissionRoute menuKey="change-password">
        <SelfServicePage />
      </PermissionRoute>
    ));

    expect(screen.getByText("修改密码页面")).toBeTruthy();
    expect(businessLoad).toHaveBeenCalledTimes(1);
  });
});
