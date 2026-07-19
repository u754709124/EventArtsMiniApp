import { z } from "zod";

export const scheduledTaskKeyValues = [
  "admin-session-cleanup",
  "admin-notification-cleanup",
  "analytics-cleanup",
  "edgeone-prefetch-reconcile",
  "automatic-backup"
] as const;

export const scheduledTaskStatusValues = ["running", "success", "failed"] as const;
export const scheduledTaskTimeZone = "Asia/Shanghai" as const;

export const ScheduledTaskKeySchema = z.enum(scheduledTaskKeyValues);
export const ScheduledTaskStatusSchema = z.enum(scheduledTaskStatusValues);

const isoDateTimeSchema = z.string().datetime({ offset: true });
const safeSummaryValueSchema = z.union([
  z.string().max(300),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

export const scheduledTaskSafeSummarySchema = z.record(
  z.string().min(1).max(80),
  safeSummaryValueSchema
).refine((value) => Object.keys(value).length <= 20, "安全摘要字段过多");

export const scheduledTaskDtoSchema = z.object({
  taskKey: ScheduledTaskKeySchema,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  cron: z.string().min(1).max(80),
  timezone: z.literal(scheduledTaskTimeZone),
  nextExecutionAt: isoDateTimeSchema,
  lastExecutionAt: isoDateTimeSchema.nullable(),
  lastFinishedAt: isoDateTimeSchema.nullable(),
  lastStatus: ScheduledTaskStatusSchema.nullable(),
  isRunning: z.boolean(),
  resultSummary: scheduledTaskSafeSummarySchema.nullable()
}).strict();

export const scheduledTaskListResponseSchema = z.object({
  items: z.array(scheduledTaskDtoSchema)
}).strict();

export const scheduledTaskRunResponseSchema = z.object({
  taskKey: ScheduledTaskKeySchema,
  status: z.enum(["success", "failed"]),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema,
  resultSummary: scheduledTaskSafeSummarySchema
}).strict();

export type ScheduledTaskKey = z.infer<typeof ScheduledTaskKeySchema>;
export type ScheduledTaskStatus = z.infer<typeof ScheduledTaskStatusSchema>;
export type ScheduledTaskSafeSummary = z.infer<typeof scheduledTaskSafeSummarySchema>;
export type ScheduledTaskDto = z.infer<typeof scheduledTaskDtoSchema>;
export type ScheduledTaskListResponse = z.infer<typeof scheduledTaskListResponseSchema>;
export type ScheduledTaskRunResponse = z.infer<typeof scheduledTaskRunResponseSchema>;
