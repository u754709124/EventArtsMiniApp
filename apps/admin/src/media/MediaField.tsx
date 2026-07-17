import { useEffect, useMemo, useState } from "react";
import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Modal, Popover, Space, Tooltip } from "antd";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { mediaFieldRules, type MediaAssetDto, type MediaFieldKey } from "@event-arts/shared";
import { request } from "../api";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { notify } from "../notifications/notification";
import { MediaLibraryModal } from "./MediaLibraryModal";
import { MediaUploadAction } from "./MediaUploadAction";

function MediaTile({ asset, testid, onRemove, sortable = false }: { asset: MediaAssetDto; testid: string; onRemove: () => void; sortable?: boolean }) {
  const sort = useSortable({ id: asset.id, disabled: !sortable });
  const [previewOpen, setPreviewOpen] = useState(false);
  const clickGuard = useRepeatClickGuard();
  return (
    <>
    <div
      ref={sort.setNodeRef}
      data-testid={`${testid}-tile`}
      className="media-field-tile"
      style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition }}
      {...(sortable ? sort.attributes : {})}
      {...(sortable ? sort.listeners : {})}
    >
      <Tooltip title={asset.resourceName}>
        <div
          data-testid={testid}
          className="media-field-preview"
          role={asset.mediaType === "video" ? "button" : undefined}
          tabIndex={asset.mediaType === "video" ? 0 : undefined}
          aria-label={asset.mediaType === "video" ? `预览 ${asset.resourceName}` : undefined}
          onClick={() => asset.mediaType === "video" && clickGuard(`${testid}:preview`, () => setPreviewOpen(true))}
          onKeyDown={(event) => {
            if (asset.mediaType === "video" && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setPreviewOpen(true);
            }
          }}
        >
          {asset.mediaType === "image" ? <img src={asset.url} alt={asset.resourceName} /> : <video src={asset.url} muted preload="metadata" />}
          {asset.mediaType === "video" && <span className="media-video-badge">视频</span>}
        </div>
      </Tooltip>
      <Button
        data-testid={`${testid.replace(/-preview$/, "")}-remove`}
        className="media-field-remove"
        shape="circle"
        size="small"
        icon={<CloseOutlined />}
        aria-label={`解除 ${asset.resourceName}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      />
    </div>
    <Modal title={asset.resourceName} open={previewOpen} footer={null} onCancel={() => setPreviewOpen(false)} destroyOnHidden>
      <video data-testid={`${testid}-video-player`} className="media-video-player" src={asset.url} controls preload="metadata" />
    </Modal>
    </>
  );
}

export function MediaField({
  value,
  onChange,
  fieldKey,
  multiple = false,
  testid = "media-field"
}: {
  value?: number | number[] | null;
  onChange?: (value: number | number[] | null) => void;
  fieldKey: MediaFieldKey;
  multiple?: boolean;
  testid?: string;
}) {
  const ids = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value]);
  const [assets, setAssets] = useState<MediaAssetDto[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const clickGuard = useRepeatClickGuard();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    let active = true;
    if (!ids.length) {
      setAssets([]);
      return;
    }
    void Promise.all(ids.map((id) => request<MediaAssetDto>(`/api/admin/media-assets/${id}`)))
      .then((items) => {
        if (active) setAssets(items);
      })
      .catch((error) => {
        if (active) notify.error(error instanceof Error ? error.message : "资源预览加载失败");
      });
    return () => {
      active = false;
    };
  }, [ids.join(",")]);

  function add(asset: MediaAssetDto) {
    setActionsOpen(false);
    setLibraryOpen(false);
    if (multiple) {
      if (!ids.includes(asset.id)) onChange?.([...ids, asset.id]);
    } else {
      onChange?.(asset.id);
    }
  }

  function remove(id: number) {
    if (multiple) onChange?.(ids.filter((item) => item !== id));
    else onChange?.(null);
  }

  const addControl = (
    <Popover
      trigger="click"
      open={actionsOpen}
      onOpenChange={setActionsOpen}
      content={
        <Space orientation="vertical">
          <Button data-testid="media-action-library" onClick={() => clickGuard(`${testid}:library:open`, () => { setActionsOpen(false); setLibraryOpen(true); })}>从资源库导入</Button>
          <MediaUploadAction fieldKey={fieldKey} onAsset={add} />
        </Space>
      }
    >
      <Button data-testid={`${testid}-add`} className="media-field-add" icon={<PlusOutlined />} aria-label="添加资源" />
    </Popover>
  );

  const rule = mediaFieldRules[fieldKey];
  const typeHint = rule.allowedTypes.map((type) => (type === "image" ? "图片" : "视频")).join("/");
  const sizeHint = rule.width && rule.height ? `推荐 ${rule.width}×${rule.height}` : "尺寸不限";

  return (
    <div data-testid={testid} className="media-field">
      {multiple ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            const from = ids.indexOf(Number(active.id));
            const to = ids.indexOf(Number(over.id));
            onChange?.(arrayMove(ids, from, to));
          }}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className="media-field-list">
              {assets.map((asset) => <MediaTile key={asset.id} asset={asset} testid={`${testid}-${asset.id}-preview`} sortable onRemove={() => clickGuard(`${testid}:remove:${asset.id}`, () => remove(asset.id))} />)}
              {addControl}
            </div>
          </SortableContext>
        </DndContext>
      ) : assets[0] ? (
        <MediaTile asset={assets[0]} testid={`${testid}-preview`} onRemove={() => clickGuard(`${testid}:remove:${assets[0].id}`, () => remove(assets[0].id))} />
      ) : (
        addControl
      )}
      <div className="media-field-hint">要求：{typeHint} · {sizeHint}</div>
      <MediaLibraryModal
        open={libraryOpen}
        fieldKey={fieldKey}
        onCancel={() => clickGuard(`${testid}:library:cancel`, () => setLibraryOpen(false))}
        onSelect={(asset) => clickGuard(`${testid}:library:select:${asset.id}`, () => add(asset))}
      />
    </div>
  );
}
