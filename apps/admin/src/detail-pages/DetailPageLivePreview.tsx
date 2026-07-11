import { useEffect, useRef, useState } from "react";
import { Button, Spin } from "antd";
import type { DetailPageBlockDto, DetailPageConfigDto, DetailPageInput } from "@event-arts/shared";
import { request } from "../api";
import "./detail-page-preview.css";
import "./detail-page-designer.css";

function PreviewBlock({ block, overlap, videoIndex }: { block: DetailPageBlockDto; overlap: boolean; videoIndex: number }) {
  if (block.type === "video") {
    return (
      <section className={`detail-preview-card${overlap ? " detail-preview-first-card-overlap" : ""}`}>
        <video className="detail-preview-video" src={block.url} controls preload="metadata" aria-label={`详情视频 ${videoIndex}`} />
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

function MobilePreview({ dto }: { dto: DetailPageConfigDto }) {
  const bannerMode = dto.type === "banner_rich_text";
  let videoIndex = 0;
  return (
    <div className={`detail-mobile-preview detail-mobile-preview-${dto.type}`} data-testid="detail-designer-live-preview">
      <header className="detail-preview-nav" aria-label="移动端导航预览">
        <span aria-hidden="true">‹</span>
        <strong>{bannerMode ? "详情预览" : dto.name || "详情页"}</strong>
        <span aria-hidden="true" />
      </header>
      {bannerMode && (
        <section className="detail-preview-hero">
          {dto.banners.map((banner, index) => (
            <img key={`${banner.assetId}-${index}`} className={index === 0 ? "detail-preview-banner is-current" : "detail-preview-banner"} src={banner.url} alt={`${dto.name} BANNER ${index + 1}`} />
          ))}
          <div className="detail-preview-hero-copy">
            <h2>{dto.hero.title}</h2>
            <p>{dto.hero.subtitle}</p>
          </div>
          {dto.banners.length > 1 && <span className="detail-preview-counter">1/{dto.banners.length}</span>}
        </section>
      )}
      <main className="detail-preview-content">
        {dto.blocks.map((block, index) => {
          if (block.type === "video") videoIndex += 1;
          return <PreviewBlock key={`${block.type}-${index}`} block={block} overlap={bannerMode && index === 0} videoIndex={videoIndex} />;
        })}
      </main>
    </div>
  );
}

export function DetailPageLivePreview({
  revision,
  getDraft
}: {
  revision: number;
  getDraft: () => DetailPageInput;
}) {
  const [dto, setDto] = useState<DetailPageConfigDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  function loadPreview() {
    const version = ++requestVersion.current;
    let draft: DetailPageInput;
    try {
      draft = getDraft();
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "请完善详情页配置");
      return;
    }
    setLoading(true);
    setError(null);
    void request<DetailPageConfigDto>("/api/admin/detail-pages/preview", {
      method: "POST",
      body: JSON.stringify({ detailPage: draft })
    })
      .then((result) => {
        if (version === requestVersion.current) setDto(result);
      })
      .catch((previewError) => {
        if (version === requestVersion.current) setError(previewError instanceof Error ? previewError.message : "预览生成失败");
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
  }

  useEffect(() => {
    const timer = window.setTimeout(loadPreview, 400);
    return () => window.clearTimeout(timer);
  }, [revision]);

  return (
    <div className="detail-live-preview-shell">
      {dto && <MobilePreview dto={dto} />}
      {!dto && !error && (
        <div className="detail-live-preview-empty">
          <span>填写后生成实时预览</span>
        </div>
      )}
      {loading && (
        <div className="detail-live-preview-loading">
          <Spin size="small" />
          <span>正在更新预览</span>
        </div>
      )}
      {error && (
        <div className="detail-live-preview-error" role="alert">
          <strong>预览失败</strong>
          <p>{error}</p>
          <Button size="small" onClick={loadPreview}>重试</Button>
        </div>
      )}
    </div>
  );
}
