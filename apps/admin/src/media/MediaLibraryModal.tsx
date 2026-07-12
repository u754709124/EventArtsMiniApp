import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, Input, Modal, Pagination, Select, Space, Spin, Tabs, Tag, message } from "antd";
import { mediaFieldRules, mediaTypeValues, type MediaAssetDto, type MediaFieldKey, type MediaType } from "@event-arts/shared";
import { request } from "../api";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";

type MediaListResponse = { items: MediaAssetDto[]; total: number; page: number; pageSize: number };

export function resolveAllowedMediaTypes(fieldKey?: MediaFieldKey, requestedTypes?: readonly MediaType[]) {
  const fieldTypes = fieldKey ? mediaFieldRules[fieldKey].allowedTypes : [...mediaTypeValues];
  const allowedTypes = requestedTypes
    ? fieldTypes.filter((type) => requestedTypes.includes(type))
    : fieldTypes;
  if (!allowedTypes.length) throw new Error("当前媒体字段没有可用的资源类型");
  return allowedTypes;
}

export function MediaLibraryModal({
  open,
  fieldKey,
  allowedTypes: requestedTypes,
  headerAction,
  onCancel,
  onSelect
}: {
  open: boolean;
  fieldKey?: MediaFieldKey;
  allowedTypes?: readonly MediaType[];
  headerAction?: ReactNode;
  onCancel: () => void;
  onSelect: (asset: MediaAssetDto) => void;
}) {
  const allowedTypes = resolveAllowedMediaTypes(fieldKey, requestedTypes);
  const allowedTypesKey = allowedTypes.join(",");
  const [mediaType, setMediaType] = useState<MediaType>(allowedTypes[0]);
  const effectiveMediaType = allowedTypes.includes(mediaType) ? mediaType : allowedTypes[0];
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string>();
  const [tags, setTags] = useState<Array<{ label: string; count: number }>>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MediaListResponse>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);
  const clickGuard = useRepeatClickGuard();

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!open) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ mediaType: effectiveMediaType, page: String(page), pageSize: "20" });
      if (q.trim()) params.set("q", q.trim());
      if (tag) params.set("tag", tag);
      const nextData = await request<MediaListResponse>(`/api/admin/media-assets?${params}`);
      if (sequence !== requestSequence.current) return;
      setData(nextData);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setData((current) => ({ ...current, items: [], total: 0, page }));
      message.error(error instanceof Error ? error.message : "资源加载失败");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [effectiveMediaType, open, page, q, tag]);

  useEffect(() => {
    if (!open) return;
    setMediaType((current) => allowedTypes.includes(current) ? current : allowedTypes[0]);
    setPage(1);
    void request<{ items: Array<{ label: string; count: number }> }>("/api/admin/media-assets/tags")
      .then((value) => setTags(value.items))
      .catch((error) => message.error(error instanceof Error ? error.message : "标签加载失败"));
  }, [open, fieldKey, allowedTypesKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal
      title={<div className="media-library-title"><span>从资源库导入</span>{headerAction}</div>}
      open={open}
      footer={null}
      width={860}
      onCancel={() => clickGuard("media-library:cancel", onCancel)}
    >
      <div data-testid="media-library-modal">
      {allowedTypes.length > 1 && (
        <Tabs
          activeKey={effectiveMediaType}
          onChange={(key) => clickGuard(`media-library:type:${key}`, () => {
            setMediaType(key as MediaType);
            setPage(1);
          })}
          items={allowedTypes.map((type) => ({ key: type, label: type === "image" ? "图片" : "视频" }))}
        />
      )}
      <Space className="media-library-filters" wrap>
        <Input.Search
          aria-label="搜索资源"
          placeholder="搜索资源名或原始文件名"
          allowClear
          onSearch={(value) => clickGuard(`media-library:search:${value}`, () => {
            setQ(value);
            setPage(1);
          })}
        />
        <Select
          aria-label="标签筛选"
          allowClear
          placeholder="全部标签"
          value={tag}
          onChange={(value) => clickGuard(`media-library:tag:${value ?? "all"}`, () => {
            setTag(value);
            setPage(1);
          })}
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
                onClick={() => clickGuard(`media-library:select:${asset.id}`, () => onSelect(asset))}
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
        <Pagination current={page} pageSize={data.pageSize} total={data.total} showSizeChanger={false} onChange={(nextPage) => clickGuard(`media-library:page:${nextPage}`, () => setPage(nextPage))} />
      )}
      </div>
    </Modal>
  );
}
