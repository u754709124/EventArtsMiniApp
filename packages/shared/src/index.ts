import { z } from "zod";

export const statusValues = ["enabled", "disabled"] as const;
export const menuTypeValues = ["host", "singer", "actor", "activity_case", "contact"] as const;
export const artistTypeValues = ["host", "singer", "actor"] as const;
export const bannerLinkTypeValues = ["none", "announcement", "case", "internal"] as const;
export const mediaUsageValues = [
  "banner",
  "default_banner",
  "menu_icon",
  "case_cover",
  "placeholder_banner",
  "placeholder_icon",
  "placeholder_case",
  "person_avatar",
  "video",
  "other"
] as const;

export type Status = (typeof statusValues)[number];
export type MenuType = (typeof menuTypeValues)[number];
export type ArtistType = (typeof artistTypeValues)[number];
export type BannerLinkType = (typeof bannerLinkTypeValues)[number];
export type MediaUsage = (typeof mediaUsageValues)[number];

export const StatusSchema = z.enum(statusValues);
export const MenuTypeSchema = z.enum(menuTypeValues);
export const ArtistTypeSchema = z.enum(artistTypeValues);
export const BannerLinkTypeSchema = z.enum(bannerLinkTypeValues);
export const MediaUsageSchema = z.enum(mediaUsageValues);

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: "ok";
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data, message: "ok" });

export const fail = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message }
});

export type MediaAssetDto = {
  id: number;
  originalName: string;
  filename: string;
  mimeType: string;
  mediaType: "image" | "video";
  usage: MediaUsage;
  url: string;
  width: number | null;
  height: number | null;
  size: number;
  storageType: "local";
  createdAt: string;
};

export type SiteConfigDto = {
  appName: string;
  subtitle: string;
  defaultBannerUrl: string;
  placeholderBannerUrl: string;
  placeholderIconUrl: string;
  placeholderCaseUrl: string;
};

export type AnnouncementDto = {
  id: number;
  summary: string;
  content: string;
  displayDurationMs: number;
  sortOrder: number;
  status: Status;
};

export type BannerDto = {
  id: number;
  title: string;
  imageUrl: string;
  linkType: BannerLinkType;
  linkTarget: string | null;
  switchDurationMs: number;
  sortOrder: number;
  status: Status;
};

export type MenuItemDto = {
  id: number;
  text: string;
  iconUrl: string;
  type: MenuType;
  configJson: unknown;
  sortOrder: number;
  status: Status;
};

export type ActivityCaseDto = {
  id: number;
  title: string;
  category: string;
  tag: string;
  coverUrl: string;
  summary: string;
  eventDate: string;
  location: string;
  detail: string;
  mediaJson: unknown;
  isFeatured: boolean;
  featuredSortOrder: number;
  sortOrder: number;
  status: Status;
};

export type ArtistDto = {
  id: number;
  name: string;
  type: ArtistType;
  avatarUrl: string | null;
  summary: string;
  tagsJson: unknown;
  detail: string;
  sortOrder: number;
  status: Status;
};

export type ClientHomeResponse = {
  site: SiteConfigDto;
  announcements: AnnouncementDto[];
  banners: BannerDto[];
  menus: MenuItemDto[];
  featuredCases: ActivityCaseDto[];
};

export type DashboardOverviewResponse = {
  todayPv: number;
  weekPv: number;
  monthPv: number;
};

export const pageViewRequestSchema = z.object({
  pagePath: z.string().min(1),
  scene: z.string().min(1).optional()
});

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const menuConfigSchemaByType = {
  host: z.object({
    defaultSort: z.enum(["sortOrder", "newest"]).default("sortOrder"),
    pageSize: z.number().int().positive().default(10)
  }),
  singer: z.object({
    defaultSort: z.enum(["sortOrder", "newest"]).default("sortOrder"),
    pageSize: z.number().int().positive().default(10)
  }),
  actor: z.object({
    defaultSort: z.enum(["sortOrder", "newest"]).default("sortOrder"),
    pageSize: z.number().int().positive().default(10)
  }),
  activity_case: z.object({
    category: z.string().optional(),
    onlyFeatured: z.boolean().default(false),
    pageSize: z.number().int().positive().default(10)
  }),
  contact: z.object({
    phone: z.string().optional(),
    address: z.string().optional(),
    wechat: z.string().optional(),
    description: z.string().optional()
  })
} satisfies Record<MenuType, z.ZodType>;

export const mediaDimensionRules: Partial<Record<MediaUsage, { width: number; height: number }>> = {
  banner: { width: 1420, height: 580 },
  default_banner: { width: 1420, height: 580 },
  placeholder_banner: { width: 1420, height: 580 },
  menu_icon: { width: 176, height: 176 },
  placeholder_icon: { width: 176, height: 176 },
  case_cover: { width: 460, height: 320 },
  placeholder_case: { width: 460, height: 320 }
};
