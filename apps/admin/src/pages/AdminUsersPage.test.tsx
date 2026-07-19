// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminIdentity } from "../api";
import type { AdminUserDto } from "@event-arts/shared";
import { AdminSessionProvider } from "../auth/session";
import { AdminUsersPage } from "./AdminUsersPage";

const apiMocks = vi.hoisted(() => ({
  createAdminUser: vi.fn(),
  issueAdminPasswordResetLink: vi.fn(),
  listAdminUsers: vi.fn(),
  revokeAdminPasswordResetLinks: vi.fn(),
  updateAdminUser: vi.fn(),
  updateAdminUserPermissions: vi.fn()
}));

vi.mock("../api", () => apiMocks);

function identity(overrides: Partial<AdminIdentity> = {}): AdminIdentity {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    username: "current",
    role: "SUPER_ADMIN",
    status: "enabled",
    permissions: [
      "dashboard",
      "media-assets",
      "user-management",
      "backups",
      "change-password",
      "scheduled-tasks",
      "system-config"
    ],
    delegablePermissions: ["dashboard", "media-assets"],
    ...overrides
  };
}

function user(overrides: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    id: 2,
    publicId: "22222222-2222-4222-8222-222222222222",
    username: "target-user",
    role: "USER",
    status: "enabled",
    permissions: ["media-assets", "change-password"],
    delegablePermissions: [],
    activatedAt: "2026-07-19T04:00:00.000Z",
    createdAt: "2026-07-19T04:00:00.000Z",
    updatedAt: "2026-07-19T04:00:00.000Z",
    ...overrides
  };
}

function renderPage(current: AdminIdentity) {
  return render(
    <MemoryRouter initialEntries={["/users"]}>
      <AdminSessionProvider value={{ identity: current, refreshIdentity: vi.fn(async () => current) }}>
        <AdminUsersPage />
      </AdminSessionProvider>
    </MemoryRouter>
  );
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "getComputedStyle", {
    value: () => ({ getPropertyValue: () => "" })
  });
});

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminUsersPage", () => {
  it("keeps ADMIN users limited to USER targets and USER reset actions", async () => {
    const current = identity({
      role: "ADMIN",
      permissions: ["media-assets", "user-management", "change-password"],
      delegablePermissions: ["media-assets"]
    });
    const targetUser = user();
    const peerAdmin = user({
      id: 3,
      publicId: "33333333-3333-4333-8333-333333333333",
      username: "peer-admin",
      role: "ADMIN"
    });
    apiMocks.listAdminUsers.mockResolvedValue({ items: [targetUser, peerAdmin], total: 2 });
    apiMocks.issueAdminPasswordResetLink.mockResolvedValue({
      purpose: "recovery",
      resetLink: "http://127.0.0.1:3001/admin/reset-password#token=" + "R".repeat(43),
      expiresAt: "2026-07-19T04:30:00.000Z",
      revokedSessionCount: 1,
      revokedResetTokenCount: 0
    });

    renderPage(current);

    await screen.findByText("target-user");
    expect(screen.queryByText("peer-admin")).toBeNull();
    expect(screen.getByTestId(`admin-user-reset-link-${targetUser.publicId}`)).toBeTruthy();
    expect(screen.queryByTestId(`admin-user-reset-link-${peerAdmin.publicId}`)).toBeNull();

    fireEvent.click(screen.getByTestId(`admin-user-reset-link-${targetUser.publicId}`));
    const dialog = await screen.findByRole("dialog", { name: "生成恢复链接" });
    expect(dialog.textContent).toContain("立即撤销目标账户全部登录会话和旧链接");
    fireEvent.change(within(dialog).getByTestId("admin-user-link-password"), { target: { value: "Admin-Password-1!" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /确认生成一次性链接/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /生成一次性链接/ }));

    await waitFor(() => expect(apiMocks.issueAdminPasswordResetLink).toHaveBeenCalledWith(targetUser.publicId, {
      purpose: "recovery",
      currentPassword: "Admin-Password-1!",
      confirmation: true
    }));
  });

  it("allows SUPER_ADMIN to issue ADMIN links but never exposes SUPER_ADMIN reset links", async () => {
    const current = identity();
    const targetAdmin = user({
      id: 4,
      publicId: "44444444-4444-4444-8444-444444444444",
      username: "target-admin",
      role: "ADMIN"
    });
    const targetSuper = user({
      id: 5,
      publicId: "55555555-5555-4555-8555-555555555555",
      username: "target-super",
      role: "SUPER_ADMIN",
      permissions: current.permissions,
      delegablePermissions: current.delegablePermissions
    });
    const resetToken = "S".repeat(43);
    apiMocks.listAdminUsers.mockResolvedValue({ items: [targetAdmin, targetSuper], total: 2 });
    apiMocks.issueAdminPasswordResetLink.mockResolvedValue({
      purpose: "recovery",
      resetLink: `http://127.0.0.1:3001/admin/reset-password#token=${resetToken}`,
      expiresAt: "2026-07-19T04:30:00.000Z",
      revokedSessionCount: 2,
      revokedResetTokenCount: 1
    });

    renderPage(current);

    await screen.findByText("target-admin");
    expect(screen.getByText("target-super")).toBeTruthy();
    expect(screen.getByTestId(`admin-user-reset-link-${targetAdmin.publicId}`)).toBeTruthy();
    expect(screen.queryByTestId(`admin-user-reset-link-${targetSuper.publicId}`)).toBeNull();

    fireEvent.click(screen.getByTestId(`admin-user-reset-link-${targetAdmin.publicId}`));
    const dialog = await screen.findByRole("dialog", { name: "生成恢复链接" });
    expect(dialog.textContent).toContain("生成管理员恢复链接将立即撤销该管理员全部登录会话和旧链接");
    fireEvent.change(within(dialog).getByTestId("admin-user-link-password"), { target: { value: "Super-Password-1!" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /确认生成一次性链接/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /生成一次性链接/ }));

    const result = await screen.findByTestId("admin-user-link-result");
    expect(result.textContent).toContain("链接只显示一次");
    expect((screen.getByTestId("admin-user-reset-link-value") as HTMLTextAreaElement).value).toContain("#token=");
    expect(JSON.stringify(localStorage)).not.toContain(resetToken);
    expect(JSON.stringify(sessionStorage)).not.toContain(resetToken);
  });
});
