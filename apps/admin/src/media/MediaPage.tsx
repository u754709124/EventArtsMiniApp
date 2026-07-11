import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, Input, Modal, Select, Space, Table, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { MediaAssetDto, MediaType } from "@event-arts/shared";
import { request } from "../api";
import { PageHeader } from "../components/PageHeader";
import { MediaUploadAction } from "./MediaUploadAction";

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
      message.error(error instanceof Error ? error.message : "资源加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadTags, mediaType, q, referenceStatus, tag]);

  useEffect(() => {
    void load(1);
  }, [load]);

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
      message.success("资源信息已更新");
      setEditing(null);
      await load(data.page);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
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
      async onOk() {
        try {
          await request(`/api/admin/media-assets/${asset.id}`, { method: "DELETE" });
          message.success("删除成功");
          await load(data.page);
        } catch (error) {
          message.error(error instanceof Error ? error.message : "删除失败");
        }
      }
    });
  }

  async function scanUnused() {
    try {
      const result = await request<{ items: MediaAssetDto[] }>("/api/admin/media-assets/scan-unused", { method: "POST" });
      setUnused(result.items);
      setSelectedUnused([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "扫描未使用资源失败");
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
      message.success(summary);
      if (result.skipped.length || result.failed.length) {
        Modal.info({
          title: "清理结果",
          content: <div><p>{summary}</p><p>跳过：{result.skipped.map((item) => `#${item.id} ${item.reason}`).join("；") || "无"}</p><p>失败：{result.failed.map((item) => `#${item.id} ${item.reason}`).join("；") || "无"}</p></div>
        });
      }
      setUnused(null);
      await load(1);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "清理资源失败");
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
      title: "操作",
      width: 170,
      fixed: "right",
      render: (_, asset) => (
        <Space>
          <Button onClick={() => { setEditing(asset); setEditName(asset.resourceName); setEditTags(asset.tags); }}>编辑</Button>
          <Button danger disabled={asset.inUse} data-testid={`media-delete-${asset.id}`} onClick={() => void remove(asset)}>删除</Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="素材库"
        breadcrumbs={["素材管理", "素材库"]}
        extra={
        <Space>
          <MediaUploadAction testid="media-upload-button" label="上传资源" onAsset={() => void load(1)} />
          <Button data-testid="media-clean-unused" onClick={() => void scanUnused()}>清理未使用资源</Button>
        </Space>
        }
      />
      <Card className="list-card">
      <Tabs
        activeKey={mediaType}
        onChange={(key) => setMediaType(key as MediaType)}
        items={[{ key: "image", label: "图片" }, { key: "video", label: "视频" }]}
      />
      <Space className="toolbar" wrap>
        <Input.Search data-testid="media-search" placeholder="搜索资源名或原始文件名" allowClear onSearch={setQ} />
        <Select
          data-testid="media-tag-filter"
          allowClear
          placeholder="全部标签"
          value={tag}
          onChange={setTag}
          options={tags.map((item) => ({ value: item.label, label: `${item.label} (${item.count})` }))}
          style={{ width: 180 }}
        />
        <Select
          data-testid="media-reference-filter"
          allowClear
          placeholder="全部使用状态"
          value={referenceStatus}
          onChange={setReferenceStatus}
          options={[{ value: "used", label: "已使用" }, { value: "unused", label: "未使用" }]}
          style={{ width: 180 }}
        />
      </Space>
      <Table
        data-testid="media-table"
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        columns={columns}
        scroll={{ x: "max-content" }}
        pagination={{ current: data.page, pageSize: data.pageSize, total: data.total, showSizeChanger: false, onChange: (page) => void load(page) }}
        locale={{ emptyText: <Empty description="暂无资源" /> }}
      />

      <Modal title="编辑资源信息" open={Boolean(editing)} okText="保存" onOk={() => void saveMetadata()} onCancel={closeMetadataEditor}>
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
        onOk={() => void cleanUnused()}
        onCancel={() => setUnused(null)}
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
