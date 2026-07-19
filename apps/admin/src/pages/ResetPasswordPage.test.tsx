// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPage } from "./ResetPasswordPage";

const apiMocks = vi.hoisted(() => ({
  clearToken: vi.fn(),
  consumeAdminPasswordResetLink: vi.fn()
}));

vi.mock("../api", () => apiMocks);

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
});

beforeEach(() => {
  apiMocks.clearToken.mockReset();
  apiMocks.consumeAdminPasswordResetLink.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ResetPasswordPage", () => {
  it("reads the fragment token once, clears it from the URL, and never persists it", async () => {
    const token = "A".repeat(43);
    window.history.pushState(null, "", `/admin/reset-password#token=${token}`);
    apiMocks.consumeAdminPasswordResetLink.mockResolvedValue({
      purpose: "recovery",
      revokedSessionCount: 1,
      revokedResetTokenCount: 1
    });

    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPasswordPage />
      </MemoryRouter>
    );

    expect(window.location.hash).toBe("");
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);

    fireEvent.change(screen.getByTestId("reset-new-password"), { target: { value: "Reset-Password-1!" } });
    fireEvent.change(screen.getByTestId("reset-confirm-password"), { target: { value: "Reset-Password-1!" } });
    fireEvent.click(screen.getByTestId("reset-password-submit"));

    await waitFor(() => expect(apiMocks.consumeAdminPasswordResetLink).toHaveBeenCalledWith({
      token,
      newPassword: "Reset-Password-1!",
      confirmPassword: "Reset-Password-1!"
    }));
    expect(apiMocks.clearToken).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(localStorage)).not.toContain(token);
    expect(JSON.stringify(sessionStorage)).not.toContain(token);
  });

  it("shows a generic invalid-link state when no fragment token is present", () => {
    window.history.pushState(null, "", "/admin/reset-password");
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPasswordPage />
      </MemoryRouter>
    );

    expect(screen.getByText("链接无效")).toBeTruthy();
    expect(apiMocks.consumeAdminPasswordResetLink).not.toHaveBeenCalled();
  });
});
