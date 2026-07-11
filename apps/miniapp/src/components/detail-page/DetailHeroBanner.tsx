import { Text, View } from "@tarojs/components";
import type { DetailHeroViewModel } from "./types";

export function DetailHeroBanner({ hero }: { hero: DetailHeroViewModel }) {
  const metaItems = hero.metaItems?.filter((item) => item.value.trim()) || [];
  return (
    <View className="detail-hero" data-testid="detail-hero">
      <View className="detail-hero__heading">
        <Text className="detail-hero__title">{hero.title}</Text>
        {hero.typeLabel && <Text className="detail-hero__type">{hero.typeLabel}</Text>}
      </View>
      {hero.subtitle && <Text className="detail-hero__subtitle">{hero.subtitle}</Text>}
      {hero.badge && <Text className="detail-hero__badge">{hero.badge}</Text>}
      {hero.tags && hero.tags.length > 0 && (
        <View className="detail-hero__tags">
          {hero.tags.slice(0, 4).map((tag) => (
            <Text key={tag} className="detail-hero__tag">
              {tag}
            </Text>
          ))}
        </View>
      )}
      <View className="detail-hero__meta">
        {hero.location && <Text className="detail-hero__location">{hero.location}</Text>}
        {metaItems.map((item) => (
          <Text key={`${item.label}-${item.value}`} className="detail-hero__meta-item">
            {item.label}：{item.value}
          </Text>
        ))}
      </View>
    </View>
  );
}
