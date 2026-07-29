import { Text, View } from "@tarojs/components";
import type { DetailHeroViewModel } from "./types";

export function DetailHeroBanner({ hero }: { hero: DetailHeroViewModel }) {
  const title = hero.title.trim();
  const typeLabel = hero.typeLabel.trim();
  const subtitle = hero.subtitle.trim();
  const badge = hero.badge.trim();
  const tags = (hero.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const location = hero.location.trim();
  const metaItems = (hero.metaItems ?? [])
    .map((item) => ({ label: item.label.trim(), value: item.value.trim() }))
    .filter((item) => item.label && item.value);
  return (
    <View className="detail-hero" data-testid="detail-hero">
      <View className="detail-hero__heading" data-testid="detail-hero-heading">
        <Text className="detail-hero__title">{title}</Text>
        {typeLabel && <Text className="detail-hero__type">{typeLabel}</Text>}
      </View>
      {subtitle && <Text className="detail-hero__subtitle">{subtitle}</Text>}
      {badge && <Text className="detail-hero__badge">{badge}</Text>}
      {tags.length > 0 && (
        <View className="detail-hero__tags">
          {tags.slice(0, 4).map((tag) => (
            <Text key={tag} className="detail-hero__tag" data-testid="detail-hero-tag">
              {tag}
            </Text>
          ))}
        </View>
      )}
      {(location || metaItems.length > 0) && (
        <View className="detail-hero__meta">
          {location && (
            <Text className="detail-hero__location" data-testid="detail-hero-location">
              {location}
            </Text>
          )}
          {metaItems.map((item) => (
            <Text
              key={`${item.label}-${item.value}`}
              className="detail-hero__meta-item"
              data-testid="detail-hero-meta-item"
            >
              {item.label}：{item.value}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
