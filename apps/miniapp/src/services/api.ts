import Taro from "@tarojs/taro";
import type { ApiResponse, ClientHomeResponse } from "@event-arts/shared";

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

export function trackPageView(pagePath: string, scene: string) {
  return request("/api/client/track/page-view", {
    method: "POST",
    data: { pagePath, scene }
  });
}
