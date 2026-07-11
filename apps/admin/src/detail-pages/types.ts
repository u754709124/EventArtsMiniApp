import type {
  DetailPageConfigDto,
  DetailPageInput,
  DetailPageType,
  MediaAssetDto
} from "@event-arts/shared";

export type DetailPageFormValue = {
  type?: DetailPageType;
  hero?: {
    title?: string;
    typeLabel?: string;
    subtitle?: string;
    badge?: string;
    tags?: string[];
    location?: string;
    metaItems?: Array<{ label?: string; value?: string }>;
  };
  /** @deprecated Use hero.subtitle in standalone forms. */
  heroSubtitle?: string;
  bannerAssetIds?: number[];
  richTextHtml?: string;
};

export type StandaloneDetailPageFormValue = {
  name?: string;
  detailPage?: DetailPageFormValue;
};

export type DetailPageOwnerPreviewData = {
  title?: string;
  avatarAssetId?: number | null;
  coverAssetId?: number | null;
  bodyAssetIds?: readonly number[];
};

export type DetailPageConfigFieldsProps = {
  form: import("antd").FormInstance;
  ownerType?: "artist" | "activity_case";
  ownerPreviewData: DetailPageOwnerPreviewData;
  initialDetailPage?: DetailPageConfigDto | null;
  disabled?: boolean;
};

export type DetailPagePreviewProps = {
  getDraft: () => DetailPageInput | Promise<DetailPageInput>;
  disabled?: boolean;
};

export type DetailTemplateAsset = Pick<MediaAssetDto, "id" | "url" | "mediaType">;
