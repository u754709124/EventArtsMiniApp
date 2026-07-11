import Taro from "@tarojs/taro";
import type { ActivityCaseListItemDto, ApiResponse, ClientHomeResponse, MenuItemDto } from "@event-arts/shared";

declare const __TARO_API_BASE_URL__: string;

const baseUrl = __TARO_API_BASE_URL__;

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type AbortableRequest<T> = {
  promise: Promise<T>;
  abort: () => void;
};

export function requestWithTask<T>(
  url: string,
  options: Partial<Taro.request.Option> = {}
): AbortableRequest<T> {
  const task = Taro.request<ApiResponse<T>>({
    url: `${baseUrl}${url}`,
    method: options.method || "GET",
    data: options.data,
    timeout: options.timeout || 10000
  });
  const promise = Promise.resolve(task).then((response) => {
    const body = response.data;
    if (!body.success)
      throw new ApiRequestError(body.error.code, body.error.message, response.statusCode);
    return body.data;
  });
  return {
    promise,
    abort: () => {
      const abortable = task as typeof task & { abort?: () => void };
      abortable.abort?.();
    }
  };
}

export async function request<T>(url: string, options: Partial<Taro.request.Option> = {}) {
  return requestWithTask<T>(url, options).promise;
}

export function getHome() {
  return request<ClientHomeResponse>("/api/client/home");
}

export function getMenuItems() {
  return request<MenuItemDto[]>("/api/client/menu-items");
}

export function getCases(filters: { q?: string; category?: string } = {}) {
  const params: string[] = [];
  const query = filters.q?.trim();
  const category = filters.category?.trim();
  if (query) params.push(`q=${encodeURIComponent(query)}`);
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  const search = params.join("&");
  return request<ActivityCaseListItemDto[]>(`/api/client/cases${search ? `?${search}` : ""}`);
}

export function trackPageView(pagePath: string, scene: string) {
  return request("/api/client/track/page-view", {
    method: "POST",
    data: { pagePath, scene }
  });
}
