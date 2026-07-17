import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  HolderOutlined,
  PlusOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Spin } from "antd";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import { notify } from "../notifications/notification";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MediaAssetDto } from "@event-arts/shared";
import { request } from "../api";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { MediaPickerModal } from "./MediaPickerModal";
import "./detail-pages.css";

export const detailBannerMinimum = 1;
export const detailBannerMaximum = 6;

export function validateDetailBannerIds(value: unknown) {
  if (!Array.isArray(value) || value.some((id) => !Number.isInteger(id) || id <= 0)) {
    return "详情页 BANNER 资源 ID 格式不正确";
  }
  if (value.length < detailBannerMinimum) return "请至少选择 1 张详情页 BANNER";
  if (value.length > detailBannerMaximum) return "详情页 BANNER 最多选择 6 张";
  if (new Set(value).size !== value.length) return "详情页 BANNER 不能选择重复资源";
  return null;
}

export const detailBannerFormRules = [
  {
    validator: (_rule: unknown, value: unknown) => {
      const problem = validateDetailBannerIds(value);
      return problem ? Promise.reject(new Error(problem)) : Promise.resolve();
    }
  }
];

type BannerTileProps = {
  asset: MediaAssetDto;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
};

function BannerTile({ asset, index, count, disabled, onMove, onRemove }: BannerTileProps) {
  const sortable = useSortable({ id: asset.id, disabled });
  const dimensions = asset.width && asset.height ? `${asset.width} × ${asset.height}` : "尺寸未知";

  return (
    <article
      ref={sortable.setNodeRef}
      data-testid={`detail-banner-item-${asset.id}`}
      className="detail-banner-item"
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    >
      <img className="detail-banner-thumbnail" src={asset.url} alt={`${asset.resourceName} 缩略图`} />
      <div className="detail-banner-metadata">
        <strong>{asset.resourceName}</strong>
        <span>{dimensions}</span>
        <span data-testid={`detail-banner-order-${asset.id}`}>第 {index + 1} 张</span>
      </div>
      <div className="detail-banner-actions">
        <Button
          ref={sortable.setActivatorNodeRef}
          className="detail-banner-drag"
          type="text"
          icon={<HolderOutlined />}
          disabled={disabled}
          aria-label={`拖拽排序 ${asset.resourceName}`}
          {...sortable.attributes}
          {...sortable.listeners}
        />
        <Button
          type="text"
          icon={<ArrowUpOutlined />}
          disabled={disabled || index === 0}
          aria-label={`将 ${asset.resourceName} 上移`}
          onClick={() => onMove(-1)}
        />
        <Button
          type="text"
          icon={<ArrowDownOutlined />}
          disabled={disabled || index === count - 1}
          aria-label={`将 ${asset.resourceName} 下移`}
          onClick={() => onMove(1)}
        />
        <Button
          danger
          type="text"
          icon={<CloseOutlined />}
          disabled={disabled}
          aria-label={`删除 ${asset.resourceName}`}
          onClick={onRemove}
        />
      </div>
    </article>
  );
}

type FailedBannerTileProps = {
  id: number;
  index: number;
  disabled: boolean;
  retrying: boolean;
  onRetry: () => void;
  onRemove: () => void;
};

function FailedBannerTile({ id, index, disabled, retrying, onRetry, onRemove }: FailedBannerTileProps) {
  return (
    <article
      data-testid={`detail-banner-error-${id}`}
      className="detail-banner-item detail-banner-item-error"
      role="alert"
    >
      <div className="detail-banner-thumbnail detail-banner-thumbnail-error">无法显示缩略图</div>
      <div className="detail-banner-metadata">
        <strong>资源 ID #{id}</strong>
        <span>元数据加载失败</span>
        <span data-testid={`detail-banner-order-${id}`}>第 {index + 1} 张</span>
      </div>
      <div className="detail-banner-actions">
        <Button
          type="text"
          icon={<ReloadOutlined />}
          disabled={disabled}
          loading={retrying}
          aria-label={`重试资源 #${id}`}
          onClick={onRetry}
        >
          重试
        </Button>
        <Button
          danger
          type="text"
          icon={<CloseOutlined />}
          disabled={disabled || retrying}
          aria-label={`删除资源 #${id}`}
          onClick={onRemove}
        >
          删除
        </Button>
      </div>
    </article>
  );
}

export type DetailBannerFieldProps = {
  value?: number[];
  onChange?: (value: number[]) => void;
  disabled?: boolean;
};

export function DetailBannerField({ value = [], onChange, disabled = false }: DetailBannerFieldProps) {
  const ids = useMemo(() => value, [value]);
  const [assets, setAssets] = useState<Map<number, MediaAssetDto>>(new Map());
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const clickGuard = useRepeatClickGuard();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    let active = true;
    if (!ids.length) {
      setAssets(new Map());
      setFailedIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      ids.map(async (id) => {
        try {
          return await request<MediaAssetDto>(`/api/admin/media-assets/${id}`);
        } catch (error) {
          notify.error(error instanceof Error ? error.message : `资源 #${id} 加载失败`);
          return { id, asset: null };
        }
      })
    ).then((items) => {
      if (!active) return;
      const loadedAssets = items.filter((item): item is MediaAssetDto => "mediaType" in item);
      setAssets(new Map(loadedAssets.map((asset) => [asset.id, asset])));
      setFailedIds(new Set(items.filter((item) => !("mediaType" in item)).map((item) => item.id)));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [ids.join(",")]);

  async function retry(id: number) {
    setRetryingIds((current) => new Set(current).add(id));
    try {
      const asset = await request<MediaAssetDto>(`/api/admin/media-assets/${id}`);
      setAssets((current) => new Map(current).set(id, asset));
      setFailedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    } catch (error) {
      setFailedIds((current) => new Set(current).add(id));
      notify.error(error instanceof Error ? error.message : `资源 #${id} 加载失败`);
    } finally {
      setRetryingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function move(id: number, offset: -1 | 1) {
    const from = ids.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    onChange?.(arrayMove(ids, from, to));
  }

  function finishDrag({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from >= 0 && to >= 0) onChange?.(arrayMove(ids, from, to));
  }

  function select(asset: MediaAssetDto) {
    if (asset.mediaType !== "image") {
      notify.warning("详情页 BANNER 只支持图片");
      return;
    }
    if (ids.includes(asset.id)) {
      notify.warning("该资源已在详情页 BANNER 中");
      return;
    }
    if (ids.length >= detailBannerMaximum) {
      notify.warning("详情页 BANNER 最多选择 6 张");
      return;
    }
    onChange?.([...ids, asset.id]);
    setPickerOpen(false);
  }

  const problem = validateDetailBannerIds(ids);
  const atMaximum = ids.length >= detailBannerMaximum;

  return (
    <div data-testid="detail-banner-field" className="detail-banner-field">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <Spin spinning={loading}>
            <div className="detail-banner-list">
              {ids.map((id, index) => {
                const asset = assets.get(id);
                return asset ? (
                  <BannerTile
                    key={id}
                    asset={asset}
                    index={index}
                    count={ids.length}
                    disabled={disabled}
                    onMove={(offset) => clickGuard(`detail-banner:move:${id}:${offset}`, () => move(id, offset))}
                    onRemove={() => clickGuard(`detail-banner:remove:${id}`, () => onChange?.(ids.filter((item) => item !== id)))}
                  />
                ) : failedIds.has(id) ? (
                  <FailedBannerTile
                    key={id}
                    id={id}
                    index={index}
                    disabled={disabled}
                    retrying={retryingIds.has(id)}
                    onRetry={() => clickGuard(`detail-banner:retry:${id}`, () => retry(id))}
                    onRemove={() => clickGuard(`detail-banner:remove:${id}`, () => onChange?.(ids.filter((item) => item !== id)))}
                  />
                ) : null;
              })}
            </div>
          </Spin>
        </SortableContext>
      </DndContext>

      <Button
        data-testid="detail-banner-add"
        className="detail-banner-add"
        icon={<PlusOutlined />}
        disabled={disabled || atMaximum}
        onClick={() => clickGuard("detail-banner:picker:open", () => setPickerOpen(true))}
      >
        从资源库选择或上传
      </Button>
      <p className="detail-banner-hint">1–6 张图片，建议约 1500×760；前台会按容器比例居中裁切。</p>
      {problem && <p className="detail-banner-error" role="alert">{problem}</p>}

      <MediaPickerModal
        open={pickerOpen}
        fieldKey="detail.banner"
        allowedTypes={["image"]}
        testid="detail-banner-picker"
        onCancel={() => clickGuard("detail-banner:picker:cancel", () => setPickerOpen(false))}
        onSelect={(asset) => clickGuard(`detail-banner:select:${asset.id}`, () => select(asset))}
      />
    </div>
  );
}
