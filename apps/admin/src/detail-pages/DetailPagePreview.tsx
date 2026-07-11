import { useRef, useState } from "react";
import { Button, Modal, Spin } from "antd";
import type { DetailPageBlockDto, DetailPageConfigDto } from "@event-arts/shared";
import { request } from "../api";
import type { DetailPagePreviewProps } from "./types";
import "./detail-page-preview.css";

function PreviewBlock({
  block,
  overlap,
  videoIndex
}: {
  block: DetailPageBlockDto;
  overlap: boolean;
  videoIndex: number;
}) {
  if (block.type === "video") {
    return (
      <section className={`detail-preview-card${overlap ? " detail-preview-first-card-overlap" : ""}`}>
        <video
          className="detail-preview-video"
          src={block.url}
          poster={block.posterUrl ?? undefined}
          controls
          preload="metadata"
          aria-label={`详情视频 ${videoIndex}`}
        />
      </section>
    );
  }
  return (
    <section
      className={`detail-preview-card detail-preview-rich-text${overlap ? " detail-preview-first-card-overlap" : ""}`}
      dangerouslySetInnerHTML={{ __html: block.html }}
    />
  );
}

function MobilePreview({ dto, title }: { dto: DetailPageConfigDto; title: string }) {
  const bannerMode = dto.type === "banner_rich_text";
  let videoIndex = 0;
  return (
    <div className={`detail-mobile-preview detail-mobile-preview-${dto.type}`}>
      <header className="detail-preview-nav" aria-label="移动端导航预览">
        <span aria-hidden="true">‹</span>
        <strong>{bannerMode ? "详情预览" : title}</strong>
        <span aria-hidden="true" />
      </header>
      {bannerMode && (
        <section className="detail-preview-hero">
          {dto.banners.map((banner, index) => (
            <img
              key={`${banner.assetId}-${index}`}
              className={index === 0 ? "detail-preview-banner is-current" : "detail-preview-banner"}
              src={banner.url}
              alt={`${title} BANNER ${index + 1}`}
            />
          ))}
          <div className="detail-preview-hero-copy">
            <h2>{title}</h2>
            <p>{dto.heroSubtitle}</p>
          </div>
          {dto.banners.length > 1 && <span className="detail-preview-counter">1/{dto.banners.length}</span>}
        </section>
      )}
      <main className="detail-preview-content">
        {dto.blocks.map((block, index) => {
          if (block.type === "video") videoIndex += 1;
          return (
            <PreviewBlock
              key={`${block.type}-${index}`}
              block={block}
              overlap={bannerMode && index === 0}
              videoIndex={videoIndex}
            />
          );
        })}
      </main>
    </div>
  );
}

export function DetailPagePreview({ getDraft, ownerPreviewData, disabled = false }: DetailPagePreviewProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dto, setDto] = useState<DetailPageConfigDto | null>(null);
  const requestVersion = useRef(0);

  async function loadPreview() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setDto(null);
    try {
      const detailPage = await getDraft();
      const result = await request<DetailPageConfigDto>("/api/admin/detail-pages/preview", {
        method: "POST",
        body: JSON.stringify({ detailPage })
      });
      if (version === requestVersion.current) setDto(result);
    } catch (loadError) {
      if (version === requestVersion.current) {
        setError(loadError instanceof Error ? loadError.message : "预览生成失败，请重试");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  function show() {
    setOpen(true);
    void loadPreview();
  }

  function close() {
    requestVersion.current += 1;
    setOpen(false);
  }

  return (
    <>
      <Button
        type="default"
        data-testid="detail-page-preview"
        className="detail-page-preview-trigger"
        disabled={disabled}
        onClick={show}
      >
        移动端预览
      </Button>
      <Modal
        title="移动端安全预览"
        open={open}
        width={455}
        rootClassName="detail-page-preview-modal"
        destroyOnHidden
        onCancel={close}
        footer={<Button aria-label="关闭预览" onClick={close}>关闭</Button>}
      >
        <div className="detail-preview-stage">
          {loading && (
            <div className="detail-preview-status" aria-live="polite">
              <Spin />
              <span>正在生成安全预览…</span>
            </div>
          )}
          {!loading && error && (
            <div className="detail-preview-error" role="alert">
              <strong>预览生成失败</strong>
              <p>{error}</p>
              <Button onClick={() => void loadPreview()}>重新生成预览</Button>
            </div>
          )}
          {!loading && dto && <MobilePreview dto={dto} title={ownerPreviewData.title?.trim() || "详情页标题"} />}
        </div>
      </Modal>
    </>
  );
}
