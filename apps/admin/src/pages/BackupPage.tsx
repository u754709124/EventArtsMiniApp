import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import type { BackupDto, BackupPreflightSummary, BackupRestoreAcceptedResponse, BackupStatus } from "@event-arts/shared";
import {
  clearToken,
  createBackup,
  deleteBackup,
  downloadBackupArchive,
  importBackupArchive,
  listBackups,
  restoreBackup
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { useNavigate } from "react-router-dom";
import { notify } from "../notifications/notification";

const restoreConfirmation = "RESTORE_FULL_BACKUP";

type CreateBackupForm = {
  note?: string;
};

type ImportResult = {
  backup: BackupDto;
  preflight: BackupPreflightSummary;
};

function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusTag(status: BackupStatus) {
  const labels: Record<BackupStatus, { text: string; color: string; status: "success" | "processing" | "warning" | "error" }> = {
    ready: { text: "可用", color: "green", status: "success" },
    verifying: { text: "校验中", color: "blue", status: "processing" },
    restoring: { text: "恢复中", color: "orange", status: "warning" },
    failed: { text: "失败", color: "red", status: "error" }
  };
  const item = labels[status];
  return <Badge status={item.status} text={<Tag color={item.color}>{item.text}</Tag>} />;
}

function backupKindTag(kind: BackupDto["backupKind"] | BackupPreflightSummary["backupKind"]) {
  const labels: Record<NonNullable<typeof kind>, { text: string; color: string }> = {
    manual: { text: "手动备份", color: "blue" },
    automatic: { text: "自动备份", color: "green" },
    restore_snapshot: { text: "恢复前快照", color: "orange" },
    imported: { text: "导入归档", color: "purple" }
  };
  if (!kind) return <Tag>旧版归档</Tag>;
  const item = labels[kind];
  return <Tag color={item.color}>{item.text}</Tag>;
}

function dataScopeTag(scope: BackupDto["dataScope"] | BackupPreflightSummary["dataScope"]) {
  if (scope === "non_identity") return <Tag color="cyan">不含身份数据</Tag>;
  if (scope === "full") return <Tag color="gold">旧格式完整数据</Tag>;
  return <Tag>数据范围未知</Tag>;
}

function dataScopeDescription(scope: BackupDto["dataScope"] | BackupPreflightSummary["dataScope"]) {
  if (scope === "non_identity") {
    return "v3 非身份备份只包含业务数据与 uploads，不包含后台账户、角色、菜单权限、会话、重置链接、个人通知、客户端会话、访问事件、任务状态和操作日志；恢复时保留当前身份平面。";
  }
  return "旧格式归档可能包含历史身份表；恢复会按兼容策略保留当前后台账户、角色、菜单权限和个人通知，候选身份数据不会成为线上身份。";
}

function restoreBehaviorTag(value: BackupPreflightSummary["impact"]["tables"][number]["restoreBehavior"]) {
  const labels: Record<typeof value, { text: string; color: string }> = {
    restored: { text: "恢复备份数据", color: "blue" },
    ignored: { text: "忽略并清空", color: "default" },
    "preserved-current": { text: "保留当前系统", color: "purple" }
  };
  const item = labels[value];
  return <Tag color={item.color}>{item.text}</Tag>;
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "操作失败";
  const apiError = error as Error & { code?: string };
  if (apiError.code === "MAINTENANCE_MODE") return "系统正在维护或恢复中，请稍后重试";
  if (apiError.code === "BACKUP_CONFLICT") return "已有备份或恢复任务正在执行，请稍后重试";
  if (apiError.code === "BACKUP_INVALID") return error.message || "备份归档无效";
  if (apiError.code === "VALIDATION_ERROR") return error.message || "备份参数校验失败";
  if (apiError.code === "UNAUTHORIZED") return "登录已失效，请重新登录";
  return error.message;
}

function checkTags(preflight: BackupPreflightSummary) {
  return [
    ["manifest", "清单", preflight.checks.manifest === "ok"],
    ["checksums", "校验和", preflight.checks.checksums === "ok"],
    ["sqliteIntegrity", "数据库完整性", preflight.checks.sqliteIntegrity === "ok"],
    ["schemaCompatible", "Schema 兼容", preflight.checks.schemaCompatible === true],
    ["mediaFiles", "媒体文件", preflight.checks.mediaFiles === "ok"]
  ] as const;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

export function BackupPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<CreateBackupForm>();
  const [backups, setBackups] = useState<BackupDto[]>([]);
  const [selectedBackupIds, setSelectedBackupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupDto | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clickGuard = useRepeatClickGuard();

  const busy = creating || importing || Boolean(restoringBackupId) || deletingIds.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listBackups();
      setBackups(data.backups);
      setSelectedBackupIds((current) => current.filter((id) => data.backups.some((backup) => backup.id === id)));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitCreate() {
    setCreating(true);
    try {
      const values = await form.validateFields();
      await createBackup({ note: values.note?.trim() || undefined });
      notify.success("备份已创建");
      setCreateOpen(false);
      form.resetFields();
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  function confirmDelete(targetIds: string[]) {
    if (!targetIds.length) return;
    Modal.confirm({
      title: targetIds.length === 1 ? "确认删除备份？" : `确认删除 ${targetIds.length} 个备份？`,
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>删除后无法从后台列表恢复，请确认已不再需要这些备份。</p>
          <Typography.Text code>{targetIds.join("，")}</Typography.Text>
        </div>
      ),
      okText: "删除备份",
      okButtonProps: { danger: true, loading: deletingIds.length > 0 },
      cancelText: "取消",
      onOk() {
        return clickGuard(`backup:delete:${targetIds.join("|")}`, async () => {
          setDeletingIds(targetIds);
          try {
            for (const backupId of targetIds) await deleteBackup(backupId);
            notify.success(targetIds.length === 1 ? "备份已删除" : "所选备份已删除");
            setSelectedBackupIds((current) => current.filter((id) => !targetIds.includes(id)));
            await load();
          } catch (error) {
            notify.error(errorMessage(error));
            throw error;
          } finally {
            setDeletingIds([]);
          }
        });
      }
    });
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importBackupArchive(file);
      setImportResult(result);
      notify.success("导入预检通过");
      await load();
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(backup: BackupDto) {
    if (backup.status !== "ready" || downloadingIds.includes(backup.id)) return;
    setDownloadingIds((current) => (current.includes(backup.id) ? current : [...current, backup.id]));
    try {
      const archive = await downloadBackupArchive(backup.id);
      saveBlob(archive.blob, archive.filename);
      notify.success("备份下载已开始");
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      setDownloadingIds((current) => current.filter((id) => id !== backup.id));
    }
  }

  async function submitRestore() {
    if (!restoreTarget || restoreText !== restoreConfirmation) return;
    setRestoringBackupId(restoreTarget.id);
    try {
      const result = await restoreBackup(restoreTarget.id);
      finishRestore(result);
    } catch (error) {
      notify.error(errorMessage(error));
    } finally {
      setRestoringBackupId(null);
    }
  }

  function finishRestore(result: BackupRestoreAcceptedResponse) {
    notify.success(`恢复完成，安全快照 ${result.snapshotBackupId} 已创建，后台会话和重置链接已失效`);
    clearToken();
    setRestoreTarget(null);
    setRestoreText("");
    navigate("/login", { replace: true });
  }

  const columns: ColumnsType<BackupDto> = [
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 180,
      render: (value) => formatDateTime(String(value))
    },
    {
      title: "备份 ID",
      dataIndex: "id",
      width: 240,
      render: (value) => <Typography.Text code copyable>{String(value)}</Typography.Text>
    },
    { title: "版本", dataIndex: "formatVersion", width: 80, render: (value) => `v${value}` },
    { title: "类型", width: 130, render: (_, backup) => backupKindTag(backup.backupKind) },
    { title: "数据范围", width: 150, render: (_, backup) => dataScopeTag(backup.dataScope) },
    { title: "状态", dataIndex: "status", width: 110, render: (value: BackupStatus) => statusTag(value) },
    { title: "创建者", width: 140, render: (_, backup) => backup.createdBy.username },
    { title: "总大小", dataIndex: "size", width: 120, render: (value) => formatBytes(Number(value)) },
    {
      title: "校验状态",
      width: 160,
      render: (_, backup) => (
        <Tooltip title={backup.sha256}>
          <Tag color="green">校验通过 {backup.sha256.slice(0, 8)}</Tag>
        </Tooltip>
      )
    },
    { title: "数据库大小", width: 130, render: (_, backup) => formatBytes(backup.database.size) },
    { title: "上传文件", dataIndex: "uploadFileCount", width: 100, render: (value) => `${value} 个` },
    { title: "备注", dataIndex: "note", width: 220, render: (value) => value || "-" },
    {
      title: "操作",
      fixed: "right",
      width: 280,
      render: (_, backup) => {
        const downloading = downloadingIds.includes(backup.id);
        const rowBusy = busy || downloading;
        return (
          <Space>
            <Button
              icon={<DownloadOutlined />}
              data-testid={`backup-download-${backup.id}`}
              disabled={busy || backup.status !== "ready" || downloading}
              loading={downloading}
              onClick={() => clickGuard(`backup:download:${backup.id}`, () => handleDownload(backup))}
            >
              下载
            </Button>
            <Button
              data-testid={`backup-restore-${backup.id}`}
              disabled={rowBusy || backup.status !== "ready"}
              loading={restoringBackupId === backup.id}
              onClick={() => clickGuard(`backup:restore:open:${backup.id}`, () => {
                setRestoreTarget(backup);
                setRestoreText("");
              })}
            >
              恢复
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              data-testid={`backup-delete-${backup.id}`}
              disabled={rowBusy || backup.status !== "ready"}
              loading={deletingIds.includes(backup.id)}
              onClick={() => clickGuard(`backup:delete:open:${backup.id}`, () => confirmDelete([backup.id]))}
            >
              删除
            </Button>
          </Space>
        );
      }
    }
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="备份与恢复"
        breadcrumbs={["账号安全", "备份与恢复"]}
        description="新备份为 v3 非身份数据备份，包含业务数据与 uploads；恢复会保留当前后台身份平面，并使现有登录与重置链接失效。"
        extra={
          <Space wrap>
            <Button
              data-testid="backup-refresh"
              icon={<ReloadOutlined />}
              loading={loading}
              disabled={busy}
              onClick={() => clickGuard("backup:refresh", load)}
            >
              刷新
            </Button>
            <Button
              data-testid="backup-create-open"
              type="primary"
              icon={<PlusOutlined />}
              loading={creating}
              disabled={busy}
              onClick={() => clickGuard("backup:create:open", () => setCreateOpen(true))}
            >
              创建备份
            </Button>
          </Space>
        }
      />

      {restoringBackupId && (
        <Alert
          data-testid="backup-maintenance-alert"
          type="warning"
          showIcon
          title="恢复执行中"
          description="服务正在进入维护窗口并执行业务数据恢复，请勿刷新或重复提交。完成后当前登录会失效。"
        />
      )}

      {loadError && (
        <Alert
          data-testid="backup-load-error"
          type="error"
          showIcon
          title="备份列表加载失败"
          description={loadError}
          action={<Button size="small" onClick={() => clickGuard("backup:error:retry", load)}>重试</Button>}
        />
      )}

      <Card className="list-card">
        <Space className="toolbar" wrap>
          <Button
            data-testid="backup-delete-selected"
            danger
            icon={<DeleteOutlined />}
            disabled={busy || selectedBackupIds.length === 0}
            loading={deletingIds.length > 0}
            onClick={() => clickGuard("backup:delete:selected:open", () => confirmDelete(selectedBackupIds))}
          >
            删除所选
          </Button>
          <Space align="center">
            <Typography.Text>外部归档</Typography.Text>
            <Button
              data-testid="backup-import-open"
              icon={<UploadOutlined />}
              loading={importing}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              导入并预检
            </Button>
            <input
              ref={fileInputRef}
              data-testid="backup-import-input"
              aria-label="导入备份归档"
              className="backup-file-input"
              type="file"
              accept=".tar,.tgz,.tar.gz,application/gzip,application/x-tar"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                void clickGuard("backup:import", () => handleImport(file));
              }}
            />
          </Space>
        </Space>

        {loading && <div data-testid="backup-loading" className="table-loading-hint">正在加载备份列表</div>}
        <Table
          data-testid="backup-table"
          rowKey="id"
          loading={loading}
          dataSource={backups}
          columns={columns}
          scroll={{ x: "max-content" }}
          rowSelection={{
            selectedRowKeys: selectedBackupIds,
            getCheckboxProps: (backup) => ({ disabled: busy || backup.status !== "ready" }),
            onChange: (keys) => setSelectedBackupIds(keys.map(String))
          }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无备份" /> }}
        />
      </Card>

      <Modal
        title="创建备份"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        okButtonProps={{ disabled: busy && !creating }}
        onOk={() => clickGuard("backup:create:submit", submitCreate)}
        onCancel={() => clickGuard("backup:create:cancel", () => setCreateOpen(false))}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="备份备注" name="note" rules={[{ max: 200, message: "备注不能超过 200 个字符" }]}>
            <Input.TextArea data-testid="backup-create-note" rows={3} placeholder="可选，记录本次备份目的" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入预检结果"
        open={Boolean(importResult)}
        width={900}
        okText="恢复此备份"
        cancelText="关闭"
        okButtonProps={{ danger: true, disabled: busy || !importResult }}
        onOk={() => {
          if (!importResult) return;
          clickGuard(`backup:restore:import:${importResult.backup.id}`, () => {
            setRestoreTarget(importResult.backup);
            setRestoreText("");
            setImportResult(null);
          });
        }}
        onCancel={() => clickGuard("backup:import-result:close", () => setImportResult(null))}
      >
        {importResult && (
          <div data-testid="backup-import-preflight">
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="备份 ID">{importResult.backup.id}</Descriptions.Item>
              <Descriptions.Item label="来源">外部归档</Descriptions.Item>
              <Descriptions.Item label="类型">{backupKindTag(importResult.preflight.backupKind)}</Descriptions.Item>
              <Descriptions.Item label="数据范围">{dataScopeTag(importResult.preflight.dataScope)}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDateTime(importResult.preflight.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="创建者">{importResult.preflight.createdBy.username}</Descriptions.Item>
              <Descriptions.Item label="数据库">{formatBytes(importResult.preflight.database.size)}</Descriptions.Item>
              <Descriptions.Item label="上传文件">{importResult.preflight.uploads.fileCount} 个 / {formatBytes(importResult.preflight.uploads.totalBytes)}</Descriptions.Item>
              <Descriptions.Item label="总大小">{formatBytes(importResult.preflight.totals.totalBytes)}</Descriptions.Item>
              <Descriptions.Item label="备注">{importResult.preflight.note || "-"}</Descriptions.Item>
            </Descriptions>
            <Alert
              type={importResult.preflight.dataScope === "non_identity" ? "info" : "warning"}
              showIcon
              className="backup-restore-summary"
              message={dataScopeDescription(importResult.preflight.dataScope)}
            />
            <Space className="backup-checks" wrap>
              {checkTags(importResult.preflight).map(([key, label, ok]) => (
                <Tag key={key} color={ok ? "green" : "red"}>{label}：{ok ? "通过" : "失败"}</Tag>
              ))}
            </Space>
            <Table
              size="small"
              rowKey="table"
              dataSource={importResult.preflight.impact.tables}
              pagination={false}
              columns={[
                { title: "表", dataIndex: "table" },
                { title: "当前行数", dataIndex: "currentRows" },
                { title: "备份行数", dataIndex: "candidateRows" },
                { title: "变化", dataIndex: "deltaRows" },
                { title: "恢复行为", dataIndex: "restoreBehavior", render: (value) => restoreBehaviorTag(value) }
              ]}
              locale={{ emptyText: <Empty description="无表级变化" /> }}
            />
          </div>
        )}
      </Modal>

      <Modal
        title="确认恢复"
        open={Boolean(restoreTarget)}
        width={720}
        okText="确认恢复"
        cancelText="取消"
        confirmLoading={Boolean(restoringBackupId)}
        okButtonProps={{ danger: true, disabled: restoreText !== restoreConfirmation || Boolean(restoringBackupId) }}
        onOk={() => clickGuard(`backup:restore:submit:${restoreTarget?.id ?? "none"}`, submitRestore)}
        onCancel={() => clickGuard("backup:restore:cancel", () => {
          if (restoringBackupId) return;
          setRestoreTarget(null);
          setRestoreText("");
        })}
      >
        {restoreTarget && (
          <div data-testid="backup-restore-modal">
            <Alert
              type="warning"
              showIcon
              title="这是破坏性恢复"
              description={`${dataScopeDescription(restoreTarget.dataScope)} 服务端会先创建恢复前安全快照，成功后当前后台会话和未使用重置链接都会失效。`}
            />
            <Descriptions size="small" bordered column={1} className="backup-restore-summary">
              <Descriptions.Item label="备份 ID">{restoreTarget.id}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDateTime(restoreTarget.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="类型">{backupKindTag(restoreTarget.backupKind)}</Descriptions.Item>
              <Descriptions.Item label="数据范围">{dataScopeTag(restoreTarget.dataScope)}</Descriptions.Item>
              <Descriptions.Item label="总大小">{formatBytes(restoreTarget.size)}</Descriptions.Item>
            </Descriptions>
            <Form layout="vertical">
              <Form.Item label={`请输入 ${restoreConfirmation} 以确认恢复`} required>
                <Input
                  data-testid="backup-restore-confirmation"
                  value={restoreText}
                  onChange={(event) => setRestoreText(event.target.value)}
                  autoComplete="off"
                />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </div>
  );
}
