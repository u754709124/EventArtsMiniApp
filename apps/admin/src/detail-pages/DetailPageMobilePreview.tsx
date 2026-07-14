import { useMemo } from "react";
import {
  enhanceDetailRichTextForPresentation,
  resolveDetailPagePresentation,
  type DetailPageCardDto,
  type DetailPageContentBlockDto,
  type DetailPageConfigDto
} from "@event-arts/shared";
import "./detail-page-preview.css";

function videoAspectRatio(block: Extract<DetailPageContentBlockDto, { type: "video" }>) {
  return block.width && block.height && block.width > 0 && block.height > 0
    ? `${block.width} / ${block.height}`
    : "16 / 9";
}

function PreviewBlock({
  block,
  videoIndex
}: {
  block: DetailPageContentBlockDto;
  videoIndex: number;
}) {
  if (block.type === "video") {
    return (
      <section className="detail-preview-video-wrap">
        <video
          className="detail-preview-video"
          src={block.url}
          poster={block.posterUrl ?? undefined}
          controls
          preload="metadata"
          aria-label={`详情视频 ${videoIndex}`}
          style={{ aspectRatio: videoAspectRatio(block) }}
        />
      </section>
    );
  }
  return (
    <section
      className="detail-preview-rich-text"
      dangerouslySetInnerHTML={{ __html: enhanceDetailRichTextForPresentation(block.html) }}
    />
  );
}

function PreviewNavigation({ overlay, title }: { overlay?: boolean; title: string }) {
  return (
    <header
      className={`detail-preview-nav${overlay ? " detail-preview-nav--overlay" : ""}`}
      aria-label="移动端导航预览"
      data-testid="detail-preview-navigation"
    >
      <span className="detail-preview-back" aria-hidden="true"><i /></span>
      <strong>{title}</strong>
      <span aria-hidden="true" />
    </header>
  );
}

function PreviewCard({
  card,
  overlap,
  videoStartIndex
}: {
  card: DetailPageCardDto;
  overlap: boolean;
  videoStartIndex: number;
}) {
  let videoIndex = videoStartIndex;
  return (
    <section className={`detail-preview-card${overlap ? " detail-preview-first-card-overlap" : ""}`}>
      {card.blocks.map((block, index) => {
        if (block.type === "video") videoIndex += 1;
        return <PreviewBlock key={`${block.type}-${index}`} block={block} videoIndex={videoIndex} />;
      })}
    </section>
  );
}

export function DetailPageMobilePreview({
  dto,
  testId
}: {
  dto: DetailPageConfigDto;
  testId?: string;
}) {
  const model = useMemo(() => resolveDetailPagePresentation(dto), [dto]);
  const bannerMode = dto.rendererKey === "bannerRichText";
  const showBanner = bannerMode && model.hasSemanticContent && model.banners.length > 0;
  let videoIndex = 0;

  return (
    <div
      className={`detail-mobile-preview detail-mobile-preview-${dto.type}`}
      data-testid={testId}
    >
      {!showBanner && <PreviewNavigation title={model.hero.title || "详情页"} />}
      {showBanner && (
        <section className="detail-preview-hero" data-testid="detail-preview-hero">
          {model.banners.map((banner, index) => (
            <img
              key={banner.id}
              className={index === 0 ? "detail-preview-banner is-current" : "detail-preview-banner"}
              src={banner.url}
              alt={`${model.hero.title || dto.name} BANNER ${index + 1}`}
            />
          ))}
          <div className="detail-preview-hero-shade" aria-hidden="true" />
          <PreviewNavigation overlay title="" />
          <div className="detail-preview-hero-copy" data-testid="detail-preview-hero-copy">
            <div className="detail-preview-hero-heading" data-testid="detail-preview-hero-heading">
              <h2>{model.hero.title}</h2>
              {model.hero.typeLabel && <span>{model.hero.typeLabel}</span>}
            </div>
            {model.hero.subtitle && <p>{model.hero.subtitle}</p>}
            {model.hero.badge && <b>{model.hero.badge}</b>}
            {model.hero.tags.length > 0 && (
              <div className="detail-preview-hero-tags">
                {model.hero.tags.slice(0, 4).map((tag) => (
                  <em key={tag} data-testid="detail-preview-hero-tag">{tag}</em>
                ))}
              </div>
            )}
            {(model.hero.location || model.hero.metaItems.length > 0) && (
              <div className="detail-preview-hero-meta">
                {model.hero.location && (
                  <span data-testid="detail-preview-hero-location">{model.hero.location}</span>
                )}
                {model.hero.metaItems.map((item) => (
                  <span
                    key={`${item.label}-${item.value}`}
                    data-testid="detail-preview-hero-meta-item"
                  >
                    {item.label}：{item.value}
                  </span>
                ))}
              </div>
            )}
          </div>
          {model.banners.length > 1 && <span className="detail-preview-counter">1/{model.banners.length}</span>}
        </section>
      )}
      <main className="detail-preview-content">
        {bannerMode && model.hasSemanticContent && model.banners.length === 0 ? (
          <section className="detail-preview-state" role="alert">
            <strong>详情媒体配置异常</strong>
            <span>BANNER 图片不存在，请稍后重试</span>
          </section>
        ) : !model.hasSemanticContent ? (
          <section className="detail-preview-state">
            <strong>详情待补充</strong>
            <span>当前详情内容为空</span>
          </section>
        ) : (
          model.cards.map((card, index) => {
            const startIndex = videoIndex;
            videoIndex += card.blocks.filter((block) => block.type === "video").length;
            return (
              <PreviewCard
                key={`card-${index}`}
                card={card}
                overlap={showBanner && index === 0}
                videoStartIndex={startIndex}
              />
            );
          })
        )}
      </main>
    </div>
  );
}
