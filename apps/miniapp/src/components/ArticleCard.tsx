import { Text, View } from "@tarojs/components";
import type { ArticleListItemDto } from "@event-arts/shared";
import { generatedAssets } from "../assets";
import { navigateToDetailPage } from "../utils/detail-page-navigation";
import { formatArticleDisplayTime } from "../utils/article-time";
import { AppImage } from "./AppImage";
import "./article-card.scss";

type Variant = "home" | "list";

export function ArticleCard({
  item,
  variant = "list",
  fallback
}: {
  item: ArticleListItemDto;
  variant?: Variant;
  fallback?: string;
}) {
  const clickable = Boolean(item.detailPageId);
  return (
    <View
      className={`article-card article-card--${variant} ${clickable ? "article-card--clickable" : "article-card--static"}`}
      data-testid={`${variant === "home" ? "home" : "article-list"}-article-card`}
      onClick={clickable ? () => navigateToDetailPage(item.detailPageId) : undefined}
    >
      <AppImage
        className="article-card__cover"
        testid={`${variant === "home" ? "home" : "article-list"}-article-cover`}
        src={item.coverUrl}
        fallback={fallback || generatedAssets.placeholderCase}
        mode="aspectFill"
      />
      <View className="article-card__body">
        <Text className="article-card__title">{item.title}</Text>
        <Text className="article-card__summary">{item.summary}</Text>
        <View className="article-card__time-row">
          <View className="article-card__clock" aria-hidden />
          <Text className="article-card__time">{formatArticleDisplayTime(item.publishedAt)}</Text>
        </View>
      </View>
    </View>
  );
}
