import { useRef, useState } from "react";
import { Button, Modal, Spin } from "antd";
import type { DetailPageConfigDto } from "@event-arts/shared";
import { request } from "../api";
import { DetailPageMobilePreview } from "./DetailPageMobilePreview";
import type { DetailPagePreviewProps } from "./types";
import "./detail-page-preview.css";

export function DetailPagePreview({ getDraft, disabled = false }: DetailPagePreviewProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dto, setDto] = useState<DetailPageConfigDto | null>(null);
  const requestVersion = useRef(0);

  async function loadPreview() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setDto(null);
    try {
      const detailPage = await getDraft();
      const result = await request<DetailPageConfigDto>("/api/admin/detail-pages/preview", {
        method: "POST",
        body: JSON.stringify({ detailPage })
      });
      if (version === requestVersion.current) setDto(result);
    } catch (loadError) {
      if (version === requestVersion.current) {
        setError(loadError instanceof Error ? loadError.message : "预览生成失败，请重试");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  function show() {
    setOpen(true);
    void loadPreview();
  }

  function close() {
    requestVersion.current += 1;
    setOpen(false);
  }

  return (
    <>
      <Button
        type="default"
        data-testid="detail-page-preview"
        className="detail-page-preview-trigger"
        disabled={disabled}
        onClick={show}
      >
        移动端预览
      </Button>
      <Modal
        title="移动端安全预览"
        open={open}
        width={455}
        rootClassName="detail-page-preview-modal"
        destroyOnHidden
        onCancel={close}
        footer={<Button aria-label="关闭预览" onClick={close}>关闭</Button>}
      >
        <div className="detail-preview-stage">
          {loading && (
            <div className="detail-preview-status" aria-live="polite">
              <Spin />
              <span>正在生成安全预览…</span>
            </div>
          )}
          {!loading && error && (
            <div className="detail-preview-error" role="alert">
              <strong>预览生成失败</strong>
              <p>{error}</p>
              <Button onClick={() => void loadPreview()}>重新生成预览</Button>
            </div>
          )}
          {!loading && dto && <DetailPageMobilePreview dto={dto} />}
        </div>
      </Modal>
    </>
  );
}
