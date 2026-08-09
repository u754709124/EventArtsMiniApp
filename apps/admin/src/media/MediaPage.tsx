import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { EdgeOnePrefetchStatus, EdgeOnePrefetchTriggerResponse, MediaAssetDto, MediaType } from "@event-arts/shared";
import { request } from "../api";
import { PageHeader } from "../components/PageHeader";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { MediaUploadAction } from "./MediaUploadAction";
import { notify } from "../notifications/notification";
import {
  edgeOnePrefetchErrorMessage,
  edgeOnePrefetchSafeFailureReason,
  edgeOnePrefetchStatusMeta,
  isEdgeOnePrefetchFailureStatus,
  listEdgeOnePrefetch,
  reconcileEdgeOnePrefetch,
  triggerEdgeOnePrefetch,
  type SafeEdgeOnePrefetchResource
} from "./edgeone-prefetch";

type ListResponse = { items: MediaAssetDto[]; total: number; page: number; pageSize: number };

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function sameTags(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function MediaPage() {
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string>();
  const [referenceStatus, setReferenceStatus] = useState<string>();
  const [tags, setTags] = useState<Array<{ label: string; count: number }>>([]);
  const [data, setData] = useState<ListResponse>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<MediaAssetDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [unused, setUnused] = useState<MediaAssetDto[] | null>(null);
  const [selectedUnused, setSelectedUnused] = useState<number[]>([]);
  const [prefetchRows, setPrefetchRows] = useState<Map<number, SafeEdgeOnePrefetchResource>>(new Map());
  const [prefetchStatusFilter, setPrefetchStatusFilter] = useState<EdgeOnePrefetchStatus | "not_started">();
  const [prefetchLoading, setPrefetchLoading] = useState(false);
  const [prefetchPending, setPrefetchPending] = useState(false);
  const [prefetchRefreshing, setPrefetchRefreshing] = useState(false);
  const [prefetchSummary, setPrefetchSummary] = useState<EdgeOnePrefetchTriggerResponse | null>(null);
  const [prefetchError, setPrefetchError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const prefetchRequestSequenceRef = useRef(0);
  const clickGuard = useRepeatClickGuard();
  const editDirty = Boolean(editing && (editName !== editing.resourceName || !sameTags(editTags, editing.tags)));

  const loadTags = useCallback(() => {
    void request<{ items: Array<{ label: string; count: number }> }>("/api/admin/media-assets/tags").then((value) => setTags(value.items));
  }, []);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ mediaType, page: String(page), pageSize: "20" });
      if (q.trim()) params.set("q", q.trim());
      if (tag) params.set("tag", tag);
      if (referenceStatus) params.set("referenceStatus", referenceStatus);
      setData(await request<ListResponse>(`/api/admin/media-assets?${params}`));
      loadTags();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "资源加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadTags, mediaType, q, referenceStatus, tag]);

  useEffect(() => {
    void load(1);
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      prefetchRequestSequenceRef.current += 1;
    };
  }, []);

  const loadPrefetchStatuses = useCallback(async (silent = false) => {
    const visibleIds = new Set(data.items.map((asset) => asset.id));
    const requestSequence = ++prefetchRequestSequenceRef.current;
    if (!silent) setPrefetchLoading(true);
    try {
      const response = visibleIds.size
        ? await listEdgeOnePrefetch([...visibleIds])
        : { items: [], total: 0, page: 1, pageSize: 100 };
      if (!mountedRef.current || requestSequence !== prefetchRequestSequenceRef.current) return;
      const nextRows = new Map<number, SafeEdgeOnePrefetchResource>();
      for (const row of response.items) {
        if (!nextRows.has(row.mediaAssetId)) nextRows.set(row.mediaAssetId, row);
      }
      setPrefetchRows(nextRows);
      setPrefetchError(null);
    } catch (error) {
      if (!mountedRef.current || requestSequence !== prefetchRequestSequenceRef.current) return;
      setPrefetchError(edgeOnePrefetchErrorMessage(error));
    } finally {
      if (mountedRef.current && requestSequence === prefetchRequestSequenceRef.current && !silent) {
        setPrefetchLoading(false);
      }
    }
  }, [data.items]);

  useEffect(() => {
    void loadPrefetchStatuses();
  }, [loadPrefetchStatuses]);

  const hasActivePrefetch = useMemo(
    () => [...prefetchRows.values()].some((row) => edgeOnePrefetchStatusMeta[row.status].active),
    [prefetchRows]
  );

  useEffect(() => {
    if (!hasActivePrefetch) return;
    let stopped = false;
    let polling = false;
    let pollCount = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (stopped || polling || document.visibilityState !== "visible") return;
      polling = true;
      pollCount += 1;
      try {
        await loadPrefetchStatuses(true);
      } finally {
        polling = false;
      }
      if (!stopped && pollCount < 12 && document.visibilityState === "visible") {
        schedule(5000);
      }
    };
    schedule(5000);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        return;
      }
      if (!stopped && !polling && pollCount < 12) {
        schedule(250);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasActivePrefetch, loadPrefetchStatuses]);

  async function executePrefetch() {
    setPrefetchPending(true);
    setPrefetchError(null);
    try {
      const result = await triggerEdgeOnePrefetch();
      if (!mountedRef.current) return;
      setPrefetchSummary(result);
      notify.success(`预热任务：提交 ${result.submitted}，跳过 ${result.skipped}，不合格 ${result.ineligible}，失败 ${result.failed}`);
      await loadPrefetchStatuses();
    } catch (error) {
      if (!mountedRef.current) return;
      const message = edgeOnePrefetchErrorMessage(error);
      setPrefetchError(message);
      notify.error(message);
    } finally {
      if (mountedRef.current) setPrefetchPending(false);
    }
  }

  function confirmPrefetch() {
    Modal.confirm({
      title: "提交未预热和失败的资源？",
      content: (
        <Space orientation="vertical" size={8}>
          <Typography.Text>系统会提交符合条件的未预热资源，以及失败、超时、取消或无效的历史资源；执行中和已成功版本会跳过。</Typography.Text>
          <Typography.Text type="secondary">“预热成功”仅表示 EdgeOne 历史任务成功，不代表资源会永久驻留所有边缘节点。</Typography.Text>
        </Space>
      ),
      okText: "开始预热",
      cancelText: "取消",
      onOk: () => clickGuard("media:edgeone-prefetch:submit", executePrefetch)
    });
  }

  async function refreshPrefetchStatuses() {
    setPrefetchRefreshing(true);
    setPrefetchError(null);
    try {
      await reconcileEdgeOnePrefetch();
      await loadPrefetchStatuses();
    } catch (error) {
      if (!mountedRef.current) return;
      const message = edgeOnePrefetchErrorMessage(error);
      setPrefetchError(message);
      notify.error(message);
    } finally {
      if (mountedRef.current) setPrefetchRefreshing(false);
    }
  }

  async function saveMetadata() {
    if (!editing) return;
    try {
      const availability = await request<{ available: boolean }>("/api/admin/media-assets/check-name", {
        method: "POST",
        body: JSON.stringify({ resourceName: editName, excludeId: editing.id })
      });
      if (!availability.available) throw new Error("资源名称已存在，请更换");
      await request(`/api/admin/media-assets/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ resourceName: editName, tags: editTags })
      });
      notify.success("资源信息已更新");
      setEditing(null);
      await load(data.page);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  function closeMetadataEditor() {
    if (editDirty && !window.confirm("当前资源信息尚未保存，确认关闭？")) return;
    setEditing(null);
  }

  async function remove(asset: MediaAssetDto) {
    Modal.confirm({
      title: "确认删除资源？",
      content: asset.resourceName,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk() {
        return clickGuard(`media:delete-confirm:${asset.id}`, async () => {
          try {
            await request(`/api/admin/media-assets/${asset.id}`, { method: "DELETE" });
            notify.success("删除成功");
            await load(data.page);
          } catch (error) {
            notify.error(error instanceof Error ? error.message : "删除失败");
          }
        });
      }
    });
  }

  async function scanUnused() {
    try {
      const result = await request<{ items: MediaAssetDto[] }>("/api/admin/media-assets/scan-unused", { method: "POST" });
      setUnused(result.items);
      setSelectedUnused([]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "扫描未使用资源失败");
    }
  }

  async function cleanUnused() {
    if (!selectedUnused.length) return;
    try {
      const result = await request<{
        deletedIds: number[];
        skipped: Array<{ id: number; reason: string }>;
        failed: Array<{ id: number; reason: string }>;
      }>("/api/admin/media-assets/batch-delete", {
        method: "POST",
        body: JSON.stringify({ ids: selectedUnused })
      });
      const summary = `已删除 ${result.deletedIds.length} 项，跳过 ${result.skipped.length} 项，失败 ${result.failed.length} 项`;
      notify.success(summary);
      if (result.skipped.length || result.failed.length) {
        notify.info([
          "清理结果",
          summary,
          `跳过：${result.skipped.map((item) => `#${item.id} ${item.reason}`).join("；") || "无"}`,
          `失败：${result.failed.map((item) => `#${item.id} ${item.reason}`).join("；") || "无"}`
        ].join("\n"));
      }
      setUnused(null);
      await load(1);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "清理资源失败");
    }
  }

  const columns: ColumnsType<MediaAssetDto> = [
    {
      title: "预览",
      width: 120,
      render: (_, asset) => asset.mediaType === "image"
        ? <img alt={asset.resourceName} src={asset.url} className="media-thumb" />
        : <video aria-label={asset.resourceName} src={asset.url} className="media-thumb" controls preload="metadata" />
    },
    { title: "资源名", dataIndex: "resourceName" },
    { title: "原始文件名", dataIndex: "originalName" },
    { title: "标签", render: (_, asset) => asset.tags.map((item) => <Tag key={item}>{item}</Tag>) },
    { title: "宽高", render: (_, asset) => `${asset.width ?? "-"} × ${asset.height ?? "-"}` },
    { title: "大小", render: (_, asset) => formatBytes(asset.size) },
    { title: "引用", render: (_, asset) => asset.inUse ? <Tag color="green">已使用 {asset.referenceCount}</Tag> : <Tag>未使用</Tag> },
    { title: "上传人", render: (_, asset) => asset.createdByName ?? (asset.createdBy ? `#${asset.createdBy}` : "-") },
    { title: "上传时间", dataIndex: "createdAt", render: (value) => new Date(String(value)).toLocaleString() },
    {
      title: "预热状态",
      width: 130,
      render: (_, asset) => {
        const row = prefetchRows.get(asset.id);
        if (!row) return <Tag>未预热</Tag>;
        const meta = edgeOnePrefetchStatusMeta[row.status];
        if (!isEdgeOnePrefetchFailureStatus(row.status)) return <Tag color={meta.color}>{meta.label}</Tag>;
        const reason = edgeOnePrefetchSafeFailureReason(row);
        return (
          <div className="media-prefetch-status-cell" aria-label={`${meta.label}：${reason}`}>
            <Tag color={meta.color}>{meta.label}</Tag>
            <Typography.Text className="media-prefetch-status-cell__reason" title={reason}>
              {reason}
            </Typography.Text>
          </div>
        );
      }
    },
    {
      title: "预热更新时间",
      width: 180,
      render: (_, asset) => {
        const row = prefetchRows.get(asset.id);
        return row ? new Date(row.updatedAt).toLocaleString() : "-";
      }
    },
    {
      title: "操作",
      width: 170,
      fixed: "right",
      render: (_, asset) => (
        <Space>
          <Button onClick={() => clickGuard(`media:edit:${asset.id}`, () => { setEditing(asset); setEditName(asset.resourceName); setEditTags(asset.tags); })}>编辑</Button>
          <Button danger disabled={asset.inUse} data-testid={`media-delete-${asset.id}`} onClick={() => clickGuard(`media:delete:${asset.id}`, () => remove(asset))}>删除</Button>
        </Space>
      )
    }
  ];

  const visibleMediaItems = prefetchStatusFilter
    ? data.items.filter((asset) => {
        const status = prefetchRows.get(asset.id)?.status;
        return prefetchStatusFilter === "not_started" ? !status : status === prefetchStatusFilter;
      })
    : data.items;

  return (
    <div className="page-stack">
      <PageHeader
        title="素材库"
        breadcrumbs={["素材管理", "素材库"]}
        extra={
        <Space wrap>
          <Button
            type="primary"
            className="media-prefetch-action"
            data-testid="media-edgeone-prefetch"
            aria-label="预热未预热和失败的 EdgeOne 资源"
            loading={prefetchPending}
            disabled={prefetchPending}
            onClick={() => clickGuard("media:edgeone-prefetch:confirm", confirmPrefetch)}
          >
            提交未预热和失败资源
          </Button>
          <MediaUploadAction testid="media-upload-button" label="上传资源" onAsset={() => void load(1)} />
          <Button data-testid="media-clean-unused" onClick={() => clickGuard("media:scan-unused", scanUnused)}>清理未使用资源</Button>
        </Space>
        }
      />
      <Card className="list-card">
      <div className="media-prefetch-panel" data-testid="media-edgeone-prefetch-panel">
        <div className="media-prefetch-panel__copy">
          <Typography.Text strong>EdgeOne 资源预热</Typography.Text>
          <Typography.Text type="secondary">状态来自服务端持久化任务；成功不代表边缘节点永久驻留。</Typography.Text>
        </div>
        <Button
          className="media-prefetch-refresh"
          data-testid="media-edgeone-prefetch-refresh"
          aria-label="协调并刷新 EdgeOne 预热状态"
          loading={prefetchRefreshing}
          disabled={prefetchPending || prefetchRefreshing}
          onClick={() => clickGuard("media:edgeone-prefetch:refresh", refreshPrefetchStatuses)}
        >
          刷新状态
        </Button>
      </div>
      {prefetchSummary && (
        <Alert
          className="media-prefetch-summary"
          data-testid="media-edgeone-prefetch-summary"
          type={prefetchSummary.failed ? "warning" : "success"}
          showIcon
          title={`本次提交 ${prefetchSummary.submitted}，跳过 ${prefetchSummary.skipped}，不合格 ${prefetchSummary.ineligible}，失败 ${prefetchSummary.failed}`}
          description={prefetchSummary.items.some((item) => item.outcome === "failed" || item.outcome === "ineligible") ? (
            <Space wrap>
              {prefetchSummary.items
                .filter((item) => item.outcome === "failed" || item.outcome === "ineligible")
                .map((item) => (
                  <Tag key={`${item.mediaAssetId}:${item.outcome}`}>
                    #{item.mediaAssetId} {item.safeErrorCode ?? item.outcome}
                  </Tag>
                ))}
            </Space>
          ) : undefined}
        />
      )}
      {prefetchError && (
        <Alert
          className="media-prefetch-summary"
          data-testid="media-edgeone-prefetch-error"
          type="error"
          showIcon
          title="EdgeOne 预热操作失败"
          description={prefetchError}
          action={
            <Button
              aria-label="重试刷新 EdgeOne 预热状态"
              disabled={prefetchPending || prefetchRefreshing}
              onClick={() => clickGuard("media:edgeone-prefetch:error-retry", refreshPrefetchStatuses)}
            >
              重试
            </Button>
          }
        />
      )}
      <Tabs
        activeKey={mediaType}
        onChange={(key) => clickGuard(`media:type:${key}`, () => setMediaType(key as MediaType))}
        items={[{ key: "image", label: "图片" }, { key: "video", label: "视频" }]}
      />
      <Space className="toolbar" wrap>
        <Input.Search data-testid="media-search" placeholder="搜索资源名或原始文件名" allowClear onSearch={setQ} />
        <Select
          data-testid="media-tag-filter"
          allowClear
          placeholder="全部标签"
          value={tag}
          onChange={(value) => clickGuard(`media:tag:${value ?? "all"}`, () => setTag(value))}
          options={tags.map((item) => ({ value: item.label, label: `${item.label} (${item.count})` }))}
          style={{ width: 180 }}
        />
        <Select
          data-testid="media-reference-filter"
          allowClear
          placeholder="全部使用状态"
          value={referenceStatus}
          onChange={(value) => clickGuard(`media:reference:${value ?? "all"}`, () => setReferenceStatus(value))}
          options={[{ value: "used", label: "已使用" }, { value: "unused", label: "未使用" }]}
          style={{ width: 180 }}
        />
        <Select
          data-testid="media-prefetch-status-filter"
          allowClear
          loading={prefetchLoading}
          placeholder="当前页全部预热状态"
          value={prefetchStatusFilter}
          onChange={(value) => clickGuard(
            `media:prefetch-status:${value ?? "all"}`,
            () => setPrefetchStatusFilter(value)
          )}
          options={[
            { value: "not_started", label: "未预热" },
            ...Object.entries(edgeOnePrefetchStatusMeta).map(([value, meta]) => ({
              value,
              label: meta.label
            }))
          ]}
          style={{ width: 180 }}
        />
      </Space>
      <Table
        data-testid="media-table"
        rowKey="id"
        loading={loading}
        dataSource={visibleMediaItems}
        columns={columns}
        scroll={{ x: "max-content" }}
        pagination={{ current: data.page, pageSize: data.pageSize, total: data.total, showSizeChanger: false, onChange: (page) => clickGuard(`media:page:${page}`, () => load(page)) }}
        locale={{ emptyText: <Empty description="暂无资源" /> }}
      />

      <Modal title="编辑资源信息" open={Boolean(editing)} okText="保存" onOk={() => clickGuard("media:metadata:save", saveMetadata)} onCancel={() => clickGuard("media:metadata:close", closeMetadataEditor)}>
        <p>资源名</p>
        <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
        <p>标签</p>
        <Select mode="tags" value={editTags} onChange={setEditTags} tokenSeparators={[",", "，"]} style={{ width: "100%" }} />
        {editing && <p>原始文件名：{editing.originalName}<br />MD5：{editing.md5}</p>}
      </Modal>

      <Modal
        title="清理未使用资源"
        open={unused !== null}
        okText="删除所选资源"
        okButtonProps={{ danger: true, disabled: !selectedUnused.length }}
        onOk={() => clickGuard("media:clean-unused", cleanUnused)}
        onCancel={() => clickGuard("media:clean-unused:cancel", () => setUnused(null))}
        width={760}
      >
        <div data-testid="media-clean-modal">
        <Table
          rowKey="id"
          size="small"
          dataSource={unused ?? []}
          rowSelection={{ selectedRowKeys: selectedUnused, onChange: (keys) => setSelectedUnused(keys.map(Number)) }}
          columns={columns.slice(0, 6)}
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: <Empty description="没有未使用资源" /> }}
        />
        </div>
      </Modal>
      </Card>
    </div>
  );
}
