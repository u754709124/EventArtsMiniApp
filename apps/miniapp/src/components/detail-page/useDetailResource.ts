import type { DetailPageRendererKey } from "@event-arts/shared";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, requestWithTask, trackPageView } from "../../services/api";
import { createDetailRequestGate } from "./request-race";

type DetailDto = {
  id: number;
  status: "enabled" | "disabled";
  detailPage?: { rendererKey?: DetailPageRendererKey };
};

export type DetailResourceState<T> =
  | { status: "loading"; data: null }
  | { status: "success"; data: T }
  | {
      status: "notFound" | "disabled" | "configMissing" | "unknownRenderer" | "error";
      data: null;
      message?: string;
    };

const rendererKeys = new Set<DetailPageRendererKey>(["bannerRichText", "richText"]);

export function classifyDetailRequestError(
  error: unknown
): Exclude<DetailResourceState<never>["status"], "loading" | "success"> {
  if (!(error instanceof ApiRequestError)) return "error";
  if (error.code === "DETAIL_PAGE_CONFIG_NOT_FOUND") return "configMissing";
  if (error.code === "UNKNOWN_DETAIL_PAGE_TYPE") return "unknownRenderer";
  if (error.code === "NOT_FOUND" || error.statusCode === 404) return "notFound";
  return "error";
}

export function useDetailResource<T extends DetailDto>({
  buildUrl,
  buildPagePath,
  scene,
  normalize
}: {
  buildUrl: (id: number) => string;
  buildPagePath: (id: number) => string;
  scene: string;
  normalize?: (data: unknown) => T;
}) {
  const [state, setState] = useState<DetailResourceState<T>>({ status: "loading", data: null });
  const gate = useRef(createDetailRequestGate());
  const currentId = useRef<number | null>(null);

  function load(rawId: string | number | undefined, propagateError = false): Promise<void> {
    const id = Number(rawId);
    currentId.current = Number.isInteger(id) && id > 0 ? id : null;
    setState({ status: "loading", data: null });
    if (currentId.current === null) {
      gate.current.dispose();
      setState({ status: "notFound", data: null, message: "详情地址无效" });
      return Promise.resolve();
    }

    const task = requestWithTask<unknown>(buildUrl(currentId.current));
    const token = gate.current.begin(String(currentId.current), task.abort);
    return task.promise
      .then((rawData) => {
        if (!gate.current.isCurrent(token)) return;
        const data = normalize ? normalize(rawData) : rawData as T;
        if (data.status !== "enabled") {
          setState({ status: "disabled", data: null });
          return;
        }
        if (!data.detailPage) {
          setState({ status: "configMissing", data: null });
          return;
        }
        if (!data.detailPage.rendererKey || !rendererKeys.has(data.detailPage.rendererKey)) {
          setState({ status: "unknownRenderer", data: null });
          return;
        }
        setState({ status: "success", data });
        void trackPageView(buildPagePath(data.id), scene).catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (!gate.current.isCurrent(token)) return;
        setState({
          status: classifyDetailRequestError(error),
          data: null,
          message: error instanceof Error ? error.message : undefined
        });
        if (propagateError) throw error;
      });
  }

  function reload() {
    if (currentId.current === null) return Promise.resolve();
    return load(currentId.current, true);
  }

  useEffect(() => () => gate.current.dispose(), []);

  return { state, load, reload };
}
