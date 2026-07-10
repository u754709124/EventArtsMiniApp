import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import "./index.scss";

const artistEntries = [
  { type: "host", title: "主持人", summary: "寻找适合活动风格的专业主持人" },
  { type: "singer", title: "歌手", summary: "发现适合现场氛围的实力歌手" },
  { type: "actor", title: "演员", summary: "挑选丰富活动体验的演艺人员" }
] as const;

function openArtist(type: (typeof artistEntries)[number]["type"]) {
  Taro.navigateTo({ url: `/pages/artists/list?type=${type}` }).catch(() => undefined);
}

export default function CategoryPage() {
  return (
    <View className="page" data-testid="category-page">
      <Text className="home-title">分类</Text>
      <View className="category-artist-list">
        {artistEntries.map((entry) => (
          <View
            key={entry.type}
            className="category-artist-entry"
            data-testid={`category-artist-${entry.type}`}
            onClick={() => openArtist(entry.type)}
          >
            <View>
              <Text className="category-artist-entry__title">{entry.title}</Text>
              <Text className="category-artist-entry__summary">{entry.summary}</Text>
            </View>
            <Text className="category-artist-entry__arrow">›</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
