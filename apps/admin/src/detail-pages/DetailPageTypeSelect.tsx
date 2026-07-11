import { Modal, Select } from "antd";
import {
  detailPageTypeDefinitions,
  detailPageTypeValues,
  type DetailPageType
} from "@event-arts/shared";

export type DetailPageTypeSelectProps = {
  value?: DetailPageType;
  onChange?: (value: DetailPageType) => void;
  bannerAssetIds?: readonly number[];
  getBannerAssetIds?: () => readonly number[] | undefined;
  disabled?: boolean;
};

export function DetailPageTypeSelect({
  value,
  onChange,
  bannerAssetIds = [],
  getBannerAssetIds,
  disabled = false
}: DetailPageTypeSelectProps) {
  function select(nextType: DetailPageType) {
    if (value === nextType) return;
    const currentBannerIds = getBannerAssetIds?.() ?? bannerAssetIds;
    if (value === "banner_rich_text" && nextType === "rich_text" && currentBannerIds.length > 0) {
      Modal.confirm({
        title: "切换为单富文本？",
        content: "当前已选择 BANNER；确认切换后，保存后解除 BANNER 资源关联。富文本内容会保留。",
        okText: "确认切换",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => onChange?.(nextType)
      });
      return;
    }
    onChange?.(nextType);
  }

  return (
    <div data-testid="detail-page-type" className="detail-page-type-select">
      <Select
        aria-label="详情页类型"
        placeholder="请选择详情页类型"
        value={value}
        disabled={disabled}
        options={detailPageTypeValues.map((type) => ({
          value: type,
          label: detailPageTypeDefinitions[type].label,
          title: detailPageTypeDefinitions[type].description
        }))}
        onChange={select}
      />
    </div>
  );
}
