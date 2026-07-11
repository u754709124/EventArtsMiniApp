import type {
  DetailOwnerType,
  DetailPageConfigDto,
  DetailPageInput,
  DetailPageType,
  MediaAssetDto
} from "@event-arts/shared";

export type DetailPageFormValue = {
  type?: DetailPageType;
  heroSubtitle?: string;
  bannerAssetIds?: number[];
  richTextHtml?: string;
};

export type DetailPageOwnerPreviewData = {
  title?: string;
  avatarAssetId?: number | null;
  coverAssetId?: number | null;
  bodyAssetIds?: readonly number[];
};

export type DetailPageConfigFieldsProps = {
  form: import("antd").FormInstance;
  ownerType: DetailOwnerType;
  ownerPreviewData: DetailPageOwnerPreviewData;
  initialDetailPage?: DetailPageConfigDto | null;
  disabled?: boolean;
};

export type DetailPagePreviewProps = {
  getDraft: () => DetailPageInput | Promise<DetailPageInput>;
  ownerPreviewData: DetailPageOwnerPreviewData;
  disabled?: boolean;
};

export type DetailTemplateAsset = Pick<MediaAssetDto, "id" | "url" | "mediaType">;
