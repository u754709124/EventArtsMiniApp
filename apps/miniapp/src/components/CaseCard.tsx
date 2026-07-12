import { Image, Text, View } from "@tarojs/components";
import type { ActivityCaseListItemDto } from "@event-arts/shared";
import { generatedAssets } from "../assets";
import { navigateToDetailPage } from "../utils/detail-page-navigation";
import { AppImage } from "./AppImage";
import "./case-card.scss";

type Variant = "compact" | "list";

function getCaseCity(location: string) {
  const trimmed = location.trim();
  if (!trimmed) return "";
  return trimmed.split(/[・·｜|,，\s/／-]+/)[0] || trimmed;
}

function prefixForVariant(variant: Variant) {
  return variant === "compact" ? "home-case" : "case-list";
}

export function CaseCard({
  item,
  variant,
  sitePlaceholderCaseUrl
}: {
  item: ActivityCaseListItemDto;
  variant: Variant;
  sitePlaceholderCaseUrl?: string;
}) {
  const clickable = Boolean(item.detailPageId);
  const prefix = prefixForVariant(variant);
  const city = getCaseCity(item.location);
  return (
    <View
      className={`case-card case-card--${variant} ${clickable ? "case-card--clickable" : "case-card--static"}`}
      data-testid={`${prefix}-card`}
      onClick={clickable ? () => navigateToDetailPage(item.detailPageId) : undefined}
    >
      <View className="case-card__image-wrap">
        <AppImage
          className="case-card__image"
          testid={`${prefix}-image`}
          src={item.coverUrl}
          fallback={sitePlaceholderCaseUrl || generatedAssets.placeholderCase}
        />
        <Text className="case-card__tag">{item.tag}</Text>
      </View>
      <View className="case-card__body">
        <Text className="case-card__title">{item.title}</Text>
        <Text className="case-card__summary">{item.summary}</Text>
        <View className="case-card__meta-row" data-testid={`${prefix}-meta`}>
          <View className="case-card__meta-group case-card__meta-group--date">
            <Image
              className="case-card__meta-icon"
              data-testid={`${prefix}-date-icon`}
              mode="aspectFit"
              src={generatedAssets.iconCaseDate}
            />
            <Text className="case-card__meta case-card__meta-date">{item.eventDate}</Text>
          </View>
          <View className="case-card__meta-group case-card__meta-group--location">
            <Image
              className="case-card__meta-icon"
              data-testid={`${prefix}-location-icon`}
              mode="aspectFit"
              src={generatedAssets.iconCaseLocation}
            />
            <Text className="case-card__meta case-card__meta-location">{city}</Text>
          </View>
        </View>
        {variant === "compact" && <Text className="case-card__button">查看详情 ›</Text>}
      </View>
    </View>
  );
}
