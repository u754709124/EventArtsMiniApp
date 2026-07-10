import { useCallback, useEffect, useState } from "react";
import { Button, Empty, Input, Modal, Pagination, Select, Space, Spin, Tabs, Tag, message } from "antd";
import { mediaFieldRules, type MediaAssetDto, type MediaFieldKey, type MediaType } from "@event-arts/shared";
import { request } from "../api";

type MediaListResponse = { items: MediaAssetDto[]; total: number; page: number; pageSize: number };

export function MediaLibraryModal({
  open,
  fieldKey,
  onCancel,
  onSelect
}: {
  open: boolean;
  fieldKey?: MediaFieldKey;
  onCancel: () => void;
  onSelect: (asset: MediaAssetDto) => void;
}) {
  const rule = fieldKey ? mediaFieldRules[fieldKey] : null;
  const allowedTypes = rule?.allowedTypes ?? (["image", "video"] as MediaType[]);
  const [mediaType, setMediaType] = useState<MediaType>(allowedTypes[0]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string>();
  const [tags, setTags] = useState<Array<{ label: string; count: number }>>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MediaListResponse>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ mediaType, page: String(page), pageSize: "20" });
      if (q.trim()) params.set("q", q.trim());
      if (tag) params.set("tag", tag);
      if (rule?.width) params.set("width", String(rule.width));
      if (rule?.height) params.set("height", String(rule.height));
      setData(await request<MediaListResponse>(`/api/admin/media-assets?${params}`));
    } catch (error) {
      setData((current) => ({ ...current, items: [], total: 0, page }));
      message.error(error instanceof Error ? error.message : "资源加载失败");
    } finally {
      setLoading(false);
    }
  }, [mediaType, open, page, q, rule?.height, rule?.width, tag]);

  useEffect(() => {
    if (!open) return;
    setMediaType(allowedTypes[0]);
    setPage(1);
    void request<{ items: Array<{ label: string; count: number }> }>("/api/admin/media-assets/tags")
      .then((value) => setTags(value.items))
      .catch((error) => message.error(error instanceof Error ? error.message : "标签加载失败"));
  }, [open, fieldKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title="从资源库导入" open={open} footer={null} width={860} onCancel={onCancel}>
      <div data-testid="media-library-modal">
      {allowedTypes.length > 1 && (
        <Tabs
          activeKey={mediaType}
          onChange={(key) => {
            setMediaType(key as MediaType);
            setPage(1);
          }}
          items={allowedTypes.map((type) => ({ key: type, label: type === "image" ? "图片" : "视频" }))}
        />
      )}
      <Space className="media-library-filters" wrap>
        <Input.Search
          aria-label="搜索资源"
          placeholder="搜索资源名或原始文件名"
          allowClear
          onSearch={(value) => {
            setQ(value);
            setPage(1);
          }}
        />
        <Select
          aria-label="标签筛选"
          allowClear
          placeholder="全部标签"
          value={tag}
          onChange={(value) => {
            setTag(value);
            setPage(1);
          }}
          options={tags.map((item) => ({ value: item.label, label: `${item.label} (${item.count})` }))}
          style={{ width: 180 }}
        />
      </Space>
      <Spin spinning={loading}>
        {data.items.length ? (
          <div className="media-library-grid">
            {data.items.map((asset) => (
              <Button
                key={asset.id}
                className="media-library-option"
                aria-label={`选择 ${asset.resourceName}`}
                onClick={() => onSelect(asset)}
              >
                {asset.mediaType === "image" ? (
                  <img src={asset.url} alt="" />
                ) : (
                  <video src={asset.url} muted preload="metadata" />
                )}
                <span>{asset.resourceName}</span>
                <small>{asset.width}×{asset.height}</small>
                <span>{asset.tags.map((item) => <Tag key={item}>{item}</Tag>)}</span>
              </Button>
            ))}
          </div>
        ) : (
          <Empty description="暂无符合要求的资源" />
        )}
      </Spin>
      {data.total > data.pageSize && (
        <Pagination current={page} pageSize={data.pageSize} total={data.total} showSizeChanger={false} onChange={setPage} />
      )}
      </div>
    </Modal>
  );
}
