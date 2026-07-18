import { z } from "zod";

export const adminNotificationLevelValues = ["success", "error", "warning", "info"] as const;
export const AdminNotificationLevelSchema = z.enum(adminNotificationLevelValues);

export const adminNotificationLimits = {
  messageMaxLength: 500,
  pageSizeMax: 100
} as const;

const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "发生时间必须是有效 ISO 时间" });

export const adminNotificationDtoSchema = z.object({
  id: z.number().int().positive(),
  clientEventId: z.string().uuid(),
  level: AdminNotificationLevelSchema,
  message: z.string().min(1).max(adminNotificationLimits.messageMaxLength),
  occurredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema
}).strict();

export const adminNotificationCreateRequestSchema = z.object({
  clientEventId: z.string().uuid("消息事件 ID 格式无效"),
  level: AdminNotificationLevelSchema,
  message: z.string().trim().min(1, "消息内容不能为空").max(
    adminNotificationLimits.messageMaxLength,
    `消息内容不能超过 ${adminNotificationLimits.messageMaxLength} 个字符`
  ),
  occurredAt: isoDateTimeSchema
}).strict();

export const adminNotificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(adminNotificationLimits.pageSizeMax).default(20),
  level: AdminNotificationLevelSchema.optional()
}).strict();

export const adminNotificationCreateResponseSchema = z.object({
  notification: adminNotificationDtoSchema.nullable(),
  persisted: z.boolean(),
  reason: z.literal("expired").nullable()
}).strict();

export const adminNotificationListResponseSchema = z.object({
  items: z.array(adminNotificationDtoSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0)
  }).strict()
}).strict();

export type AdminNotificationLevel = z.infer<typeof AdminNotificationLevelSchema>;
export type AdminNotificationDto = z.infer<typeof adminNotificationDtoSchema>;
export type AdminNotificationCreateRequest = z.infer<typeof adminNotificationCreateRequestSchema>;
export type AdminNotificationCreateResponse = z.infer<typeof adminNotificationCreateResponseSchema>;
export type AdminNotificationListQuery = z.infer<typeof adminNotificationListQuerySchema>;
export type AdminNotificationListResponse = z.infer<typeof adminNotificationListResponseSchema>;
