import type {
  EdgeOnePrefetchListResponse,
  EdgeOnePrefetchStatus,
  EdgeOnePrefetchTriggerResponse
} from "@event-arts/shared";
import { ApiError, request } from "../api";

export type SafeEdgeOnePrefetchResource = EdgeOnePrefetchListResponse["items"][number];

export type SafeEdgeOnePrefetchListResponse = Omit<EdgeOnePrefetchListResponse, "items"> & {
  items: SafeEdgeOnePrefetchResource[];
};

export type EdgeOnePrefetchReconcileResponse = {
  scanned: number;
  queried: number;
  recovered: number;
  retried: number;
  failed: number;
};

export const edgeOnePrefetchStatusMeta: Record<
  EdgeOnePrefetchStatus,
  { label: string; color: string; active: boolean }
> = {
  reserved: { label: "等待提交", color: "gold", active: true },
  submitting: { label: "正在提交", color: "processing", active: true },
  processing: { label: "预热中", color: "processing", active: true },
  success: { label: "预热成功", color: "success", active: false },
  failed: { label: "预热失败", color: "error", active: false },
  timeout: { label: "预热超时", color: "warning", active: false },
  canceled: { label: "已取消", color: "default", active: false },
  invalid: { label: "资源无效", color: "error", active: false }
};

export function edgeOnePrefetchSafeFailureReason(row: SafeEdgeOnePrefetchResource) {
  const code = row.safeErrorCode?.trim();
  const message = row.safeErrorMessage?.trim();
  if (code && message) return `${code}：${message}`;
  if (message) return message;
  if (code) return code;
  return "预热失败，暂无可展示原因";
}

export function triggerEdgeOnePrefetch() {
  return request<EdgeOnePrefetchTriggerResponse>("/api/admin/edgeone/prefetch", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function listEdgeOnePrefetch(
  assetIds: number[],
  page = 1,
  pageSize = 100
): Promise<SafeEdgeOnePrefetchListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize)
  });
  if (assetIds.length) params.set("assetIds", assetIds.join(","));
  const response = await request<EdgeOnePrefetchListResponse>(
    `/api/admin/edgeone/prefetch?${params}`
  );
  return {
    ...response,
    items: response.items.map((item) => ({
      id: item.id,
      mediaAssetId: item.mediaAssetId,
      mode: item.mode,
      status: item.status,
      attemptCount: item.attemptCount,
      nextRetryAt: item.nextRetryAt,
      lastSubmittedAt: item.lastSubmittedAt,
      completedAt: item.completedAt,
      safeErrorCode: item.safeErrorCode,
      safeErrorMessage: item.safeErrorMessage,
      updatedAt: item.updatedAt
    }))
  };
}

export function reconcileEdgeOnePrefetch() {
  return request<EdgeOnePrefetchReconcileResponse>(
    "/api/admin/edgeone/prefetch/reconcile",
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function edgeOnePrefetchErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "预热服务暂不可用，请稍后重试";
  }
  const messages: Record<string, string> = {
    EDGEONE_PREFETCH_DISABLED: "资源预热功能尚未启用，请联系管理员完成上线配置后重试。",
    EDGEONE_NOT_CONFIGURED: "尚未配置 EdgeOne，请先在系统配置中填写 ZoneId 和 CAM 凭证。",
    EDGEONE_INVALID_CREDENTIALS: "CAM 凭证无效，请在系统配置中更新后重试。",
    EDGEONE_PERMISSION_DENIED: "CAM 子账号缺少预热查询或创建权限，请补充最小权限后重试。",
    EDGEONE_PREFETCH_QUOTA_EXCEEDED: "EdgeOne 预热配额不足，请检查套餐配额后重试。",
    EDGEONE_RATE_LIMITED: "操作过于频繁，请稍后再试。",
    RATE_LIMITED: "操作过于频繁，请稍后再试。",
    NETWORK_ERROR: "网络连接失败，请检查网络后重试。",
    EDGEONE_UPSTREAM_UNAVAILABLE: "腾讯云 EdgeOne 服务暂不可用，请稍后重试。"
  };
  return messages[error.code] ?? error.message;
}
