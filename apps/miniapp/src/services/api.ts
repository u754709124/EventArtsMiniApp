import Taro from "@tarojs/taro";
import type { ApiResponse, ClientHomeResponse } from "@event-arts/shared";

const baseUrl = process.env.TARO_APP_API_BASE_URL || "http://127.0.0.1:3001";

export async function request<T>(url: string, options: Partial<Taro.request.Option> = {}) {
  const response = await Taro.request<ApiResponse<T>>({
    url: `${baseUrl}${url}`,
    method: options.method || "GET",
    data: options.data,
    timeout: 10000
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.error.message);
  }
  return body.data;
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
