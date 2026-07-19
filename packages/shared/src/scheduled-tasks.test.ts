import { describe, expect, it } from "vitest";
import {
  scheduledTaskDtoSchema,
  scheduledTaskKeyValues,
  scheduledTaskListResponseSchema,
  scheduledTaskRunResponseSchema
} from "./scheduled-tasks";

describe("scheduled task shared contracts", () => {
  it("accepts the server-owned scheduled task DTO shape", () => {
    expect(scheduledTaskKeyValues).toContain("automatic-backup");

    const dto = scheduledTaskDtoSchema.parse({
      taskKey: "admin-session-cleanup",
      name: "管理员会话清理",
      description: "删除已过期的后台管理员登录会话。",
      cron: "2 * * * *",
      timezone: "Asia/Shanghai",
      nextExecutionAt: "2026-07-18T01:02:00.000Z",
      lastExecutionAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      isRunning: false,
      resultSummary: null
    });

    expect(dto.taskKey).toBe(scheduledTaskKeyValues[0]);
    expect(scheduledTaskListResponseSchema.parse({ items: [dto] }).items).toHaveLength(1);
    expect(scheduledTaskRunResponseSchema.parse({
      taskKey: "automatic-backup",
      status: "success",
      startedAt: "2026-07-18T16:00:00.000Z",
      finishedAt: "2026-07-18T16:00:05.000Z",
      resultSummary: {
        status: "completed",
        createdBackupId: "backup-20260718T160000000Z-abcdef123456",
        backupKind: "automatic",
        dataScope: "non_identity",
        keepCount: 3,
        deletedCount: 1
      }
    }).taskKey).toBe("automatic-backup");
  });

  it("rejects unknown status, arbitrary fields, and unsafe result summaries", () => {
    expect(() => scheduledTaskDtoSchema.parse({
      taskKey: "admin-session-cleanup",
      name: "管理员会话清理",
      description: "删除已过期的后台管理员登录会话。",
      cron: "2 * * * *",
      timezone: "Asia/Shanghai",
      nextExecutionAt: "2026-07-18T01:02:00.000Z",
      lastExecutionAt: null,
      lastFinishedAt: null,
      lastStatus: "paused",
      isRunning: false,
      resultSummary: null
    })).toThrow();

    expect(() => scheduledTaskRunResponseSchema.parse({
      taskKey: "analytics-cleanup",
      status: "success",
      startedAt: "2026-07-18T01:00:00.000Z",
      finishedAt: "2026-07-18T01:00:01.000Z",
      resultSummary: { deletedCount: 1, nested: { secretKey: "blocked" } }
    })).toThrow();
  });
});
