import type { DetailPageBlockDto } from "@event-arts/shared";

export type ExtractDetailPageVideoBlock = Extract<DetailPageBlockDto, { type: "video" }>;
