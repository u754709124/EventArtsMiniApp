// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupDto, BackupImportPreflightResponse, BackupListResponse } from "@event-arts/shared";
import { BackupPage } from "./BackupPage";

const apiMocks = vi.hoisted(() => ({
  clearToken: vi.fn(),
  createBackup: vi.fn(),
  deleteBackup: vi.fn(),
  importBackupArchive: vi.fn(),
  listBackups: vi.fn(),
  restoreBackup: vi.fn()
}));

vi.mock("../api", () => apiMocks);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function backup(id = "backup-20260712"): BackupDto {
  return {
    id,
    formatVersion: 1,
    status: "ready",
    createdBy: { adminId: 1, username: "admin" },
    createdAt: "2026-07-12T08:30:00.000Z",
    size: 2048,
    sha256: "a".repeat(64),
    database: {
      size: 1024,
      sha256: "b".repeat(64),
      snapshotMethod: "sqlite-vacuum-into"
    },
    uploadFileCount: 3,
    note: "上线前备份"
  };
}

function importResult(): BackupImportPreflightResponse {
  const item = backup("import-20260712");
  return {
    backup: item,
    preflight: {
      formatVersion: 1,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      note: item.note,
      source: "external_archive",
      database: {
        size: 1024,
        snapshotMethod: "sqlite-vacuum-into",
        pageSize: 4096,
        pageCount: 1
      },
      uploads: { fileCount: 3, totalBytes: 1024 },
      totals: { fileCount: 4, totalBytes: 2048 },
      checks: {
        manifest: "ok",
        checksums: "ok",
        sqliteIntegrity: "ok",
        schemaCompatible: true,
        mediaFiles: "ok"
      },
      impact: {
        tables: [{ table: "media_assets", currentRows: 1, candidateRows: 2, deltaRows: 1 }]
      }
    }
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/backups"]}>
      <Routes>
        <Route path="/backups" element={<BackupPage />} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
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
    value: () => ({
      getPropertyValue: () => ""
    })
  });
});

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
});

afterEach(() => {
  cleanup();
});

describe("BackupPage", () => {
  it("shows loading, empty, and retryable error states", async () => {
    const pending = deferred<BackupListResponse>();
    apiMocks.listBackups.mockReturnValueOnce(pending.promise);

    renderPage();
    expect(screen.getByTestId("backup-loading").textContent).toContain("正在加载备份列表");
    pending.resolve({ backups: [] });
    await waitFor(() => expect(screen.getByText("暂无备份")).toBeTruthy());

    cleanup();
    apiMocks.listBackups.mockReset();
    apiMocks.listBackups
      .mockRejectedValueOnce(new Error("服务不可用"))
      .mockResolvedValueOnce({ backups: [] });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("backup-load-error").textContent).toContain("服务不可用"));
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await waitFor(() => expect(apiMocks.listBackups).toHaveBeenCalledTimes(2));
  });

  it("creates a manual backup", async () => {
    apiMocks.listBackups
      .mockResolvedValueOnce({ backups: [backup()] })
      .mockResolvedValue({ backups: [backup()] });
    apiMocks.createBackup.mockResolvedValue({ backup: backup("backup-created") });

    renderPage();
    await screen.findByText("上线前备份");

    fireEvent.click(screen.getByTestId("backup-create-open"));
    const createDialog = await screen.findByRole("dialog", { name: "创建备份" });
    fireEvent.change(within(createDialog).getByTestId("backup-create-note"), { target: { value: "手动检查点" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: /创\s*建/ }));
    await waitFor(() => expect(apiMocks.createBackup).toHaveBeenCalledWith({ note: "手动检查点" }));
    await waitFor(() => expect(apiMocks.listBackups).toHaveBeenCalledTimes(2));
  });

  it("deletes a confirmed backup", async () => {
    apiMocks.listBackups
      .mockResolvedValueOnce({ backups: [backup()] })
      .mockResolvedValue({ backups: [] });
    apiMocks.deleteBackup.mockResolvedValue({ backupId: "backup-20260712" });

    renderPage();
    await screen.findByText("上线前备份");

    fireEvent.click(screen.getByTestId("backup-delete-backup-20260712"));
    const deleteDialog = await screen.findByRole("dialog", { name: "确认删除备份？" });
    expect(deleteDialog.textContent).toContain("backup-20260712");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: /删\s*除\s*备\s*份/ }));
    await waitFor(() => expect(apiMocks.deleteBackup).toHaveBeenCalledWith("backup-20260712"));
  });

  it("imports an external archive and displays only a safe preflight summary", async () => {
    apiMocks.listBackups.mockResolvedValue({ backups: [] });
    apiMocks.importBackupArchive.mockResolvedValue(importResult());

    renderPage();
    await waitFor(() => expect(apiMocks.listBackups).toHaveBeenCalledTimes(1));

    const file = new File(["archive"], "backup.tar.gz", { type: "application/gzip" });
    fireEvent.change(screen.getByTestId("backup-import-input"), { target: { files: [file] } });

    await waitFor(() => expect(apiMocks.importBackupArchive).toHaveBeenCalledWith(file));
    const preflight = await screen.findByTestId("backup-import-preflight");
    expect(preflight.textContent).toContain("import-20260712");
    expect(preflight.textContent).toContain("清单：通过");
    expect(preflight.textContent).toContain("media_assets");
    expect(preflight.textContent).not.toContain("manifest.json");
    expect(preflight.textContent).not.toContain("database.sqlite");
  });

  it("requires exact restore confirmation and clears the session after success", async () => {
    apiMocks.listBackups.mockResolvedValue({ backups: [backup()] });
    apiMocks.restoreBackup.mockResolvedValue({
      restoreId: "restore-20260712",
      backupId: "backup-20260712",
      snapshotBackupId: "backup-safety",
      revokedSessionCount: 2
    });

    renderPage();
    await screen.findByText("上线前备份");

    fireEvent.click(screen.getByTestId("backup-restore-backup-20260712"));
    const restoreDialog = await screen.findByTestId("backup-restore-modal");
    expect(restoreDialog.textContent).toContain("当前登录和其他管理员会话都会失效");
    expect((within(restoreDialog).getByTestId("backup-restore-confirmation") as HTMLInputElement).value).toBe("");

    fireEvent.change(within(restoreDialog).getByTestId("backup-restore-confirmation"), {
      target: { value: "RESTORE_FULL_BACKUP" }
    });
    fireEvent.click(screen.getByRole("button", { name: /确\s*认\s*恢\s*复/ }));

    await waitFor(() => expect(apiMocks.restoreBackup).toHaveBeenCalledWith("backup-20260712"));
    expect(apiMocks.clearToken).toHaveBeenCalledTimes(1);
    await screen.findByText("登录页");
  });
});
