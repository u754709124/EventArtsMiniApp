import { useEffect, useRef, useState } from "react";
import { Button, Spin } from "antd";
import type { DetailPageConfigDto, DetailPageInput } from "@event-arts/shared";
import { request } from "../api";
import { DetailPageMobilePreview } from "./DetailPageMobilePreview";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import "./detail-page-designer.css";

export function DetailPageLivePreview({
  revision,
  getDraft
}: {
  revision: number;
  getDraft: () => DetailPageInput;
}) {
  const [dto, setDto] = useState<DetailPageConfigDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const clickGuard = useRepeatClickGuard();

  function loadPreview() {
    const version = ++requestVersion.current;
    let draft: DetailPageInput;
    try {
      draft = getDraft();
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "请完善详情页配置");
      return;
    }
    setLoading(true);
    setError(null);
    void request<DetailPageConfigDto>("/api/admin/detail-pages/preview", {
      method: "POST",
      body: JSON.stringify({ detailPage: draft })
    })
      .then((result) => {
        if (version === requestVersion.current) setDto(result);
      })
      .catch((previewError) => {
        if (version === requestVersion.current) setError(previewError instanceof Error ? previewError.message : "预览生成失败");
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
  }

  useEffect(() => {
    const timer = window.setTimeout(loadPreview, 400);
    return () => window.clearTimeout(timer);
  }, [revision]);

  return (
    <div className="detail-live-preview-shell">
      {dto && <DetailPageMobilePreview dto={dto} testId="detail-designer-live-preview" />}
      {!dto && !error && (
        <div className="detail-live-preview-empty">
          <span>填写后生成实时预览</span>
        </div>
      )}
      {loading && (
        <div className="detail-live-preview-loading">
          <Spin size="small" />
          <span>正在更新预览</span>
        </div>
      )}
      {error && (
        <div className="detail-live-preview-error" role="alert">
          <strong>预览失败</strong>
          <p>{error}</p>
          <Button size="small" onClick={() => clickGuard("detail-live-preview:retry", loadPreview)}>重试</Button>
        </div>
      )}
    </div>
  );
}
