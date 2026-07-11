import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, Modal, Space, message } from "antd";
import {
  buildActivityCaseTemplate,
  buildArtistProfileTemplate,
  detailContentTemplates,
  detailPageTypeDefinitions,
  type DetailPageType,
  type MediaAssetDto
} from "@event-arts/shared";
import { request } from "../api";
import { DetailBannerField, detailBannerFormRules } from "./DetailBannerField";
import { DetailPagePreview } from "./DetailPagePreview";
import { DetailPageTypeSelect } from "./DetailPageTypeSelect";
import { RichTextEditorField } from "./RichTextEditorField";
import {
  detailFieldPaths,
  detailPageConfigDtoToFormValue,
  extractRichTextMediaAssetIds,
  hydrateTemplateMediaSources,
  isMeaningfulRichText,
  normalizeDetailPageFormValue,
  uniquePositiveAssetIds
} from "./detail-page-form-utils";
import type { DetailPageConfigFieldsProps } from "./types";
import "./detail-page-config.css";

const richTextRules = [
  {
    validator: (_rule: unknown, value: unknown) =>
      typeof value === "string" && value.trim()
        ? Promise.resolve()
        : Promise.reject(new Error("请填写详情页富文本"))
  }
];

export function DetailPageConfigFields({
  form,
  ownerType,
  ownerPreviewData,
  initialDetailPage,
  disabled = false
}: DetailPageConfigFieldsProps) {
  const watchedType = Form.useWatch(["detailPage", "type"], form) as DetailPageType | undefined;
  const [type, setType] = useState<DetailPageType | undefined>(
    initialDetailPage?.type ?? (form.getFieldValue(["detailPage", "type"]) as DetailPageType | undefined)
  );
  const bannerAssetIds = Form.useWatch(["detailPage", "bannerAssetIds"], form) as number[] | undefined;
  const hydratedDto = useRef<unknown>(undefined);
  const [templateLoading, setTemplateLoading] = useState(false);

  useEffect(() => {
    if (initialDetailPage === undefined || hydratedDto.current === initialDetailPage) return;
    hydratedDto.current = initialDetailPage;
    if (initialDetailPage === null) {
      form.setFieldValue(["detailPage"], undefined);
      setType(undefined);
      return;
    }
    form.setFieldValue(["detailPage"], detailPageConfigDtoToFormValue(initialDetailPage));
    setType(initialDetailPage.type);
  }, [form, initialDetailPage]);

  useEffect(() => {
    setType(watchedType);
  }, [watchedType]);

  async function buildDraft() {
    if (!type) throw new Error("请先选择详情页类型");
    await form.validateFields(detailFieldPaths(type));
    return normalizeDetailPageFormValue(form.getFieldValue(["detailPage"]));
  }

  async function applyTemplate() {
    setTemplateLoading(true);
    try {
      const currentDetail = form.getFieldValue(["detailPage"]) as Record<string, unknown> | undefined;
      const ids = uniquePositiveAssetIds([
        ...(bannerAssetIds ?? []),
        ownerPreviewData.coverAssetId,
        ownerPreviewData.avatarAssetId,
        ...(ownerPreviewData.bodyAssetIds ?? []),
        ...extractRichTextMediaAssetIds(currentDetail?.richTextHtml)
      ]);
      if (!ids.length) throw new Error("请先选择封面、BANNER 或正文媒体资源，再应用参考模板");
      const assets = await Promise.all(ids.map((id) => request<MediaAssetDto>(`/api/admin/media-assets/${id}`)));
      const imageIds = assets.filter((asset) => asset.mediaType === "image").map((asset) => asset.id);
      const firstVideoId = assets.find((asset) => asset.mediaType === "video")?.id;
      const template = ownerType === "artist"
        ? buildArtistProfileTemplate(imageIds)
        : buildActivityCaseTemplate(imageIds, firstVideoId);
      form.setFieldValue(
        ["detailPage", "richTextHtml"],
        hydrateTemplateMediaSources(template, assets)
      );
      message.success("参考模板已应用，可继续编辑");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "参考模板应用失败");
    } finally {
      setTemplateLoading(false);
    }
  }

  function requestTemplate() {
    const currentHtml = form.getFieldValue(["detailPage", "richTextHtml"]);
    if (!isMeaningfulRichText(currentHtml)) {
      void applyTemplate();
      return;
    }
    Modal.confirm({
      title: "覆盖当前富文本内容？",
      content: "应用参考模板会覆盖当前富文本内容，确认后仍可继续编辑。",
      okText: "应用模板",
      cancelText: "取消",
      onOk: applyTemplate
    });
  }

  const template = ownerType === "artist" ? detailContentTemplates.artistProfile : detailContentTemplates.activityCase;
  const configFields = type ? new Set(detailPageTypeDefinitions[type].configFields) : new Set();

  return (
    <section className="detail-page-config" aria-label="详情页配置">
      <Form.Item
        label="详情页类型"
        name={["detailPage", "type"]}
        rules={[{ required: true, message: "请选择详情页类型" }]}
      >
        <DetailPageTypeSelect
          bannerAssetIds={bannerAssetIds}
          getBannerAssetIds={() => form.getFieldValue(["detailPage", "bannerAssetIds"]) as number[] | undefined}
          disabled={disabled}
          onChange={setType}
        />
      </Form.Item>

      {!type ? (
        <div data-testid="detail-page-empty-hint" className="detail-page-empty-hint" role="status">
          {initialDetailPage === null && <strong>详情待补充</strong>}
          <span>请先选择详情页类型</span>
        </div>
      ) : (
        <div className="detail-page-dynamic-fields">
          {configFields.has("heroSubtitle") && (
              <Form.Item
                label="BANNER 宣传语"
                name={["detailPage", "heroSubtitle"]}
                rules={[{ required: true, whitespace: true, message: "请输入 BANNER 宣传语" }]}
              >
                <Input
                  data-testid="detail-hero-subtitle"
                  aria-label="BANNER 宣传语"
                  maxLength={80}
                  disabled={disabled}
                  placeholder="请输入显示在 BANNER 上的辅助文案"
                />
              </Form.Item>
          )}
          {configFields.has("banners") && (
              <Form.Item
                label="详情页 BANNER"
                name={["detailPage", "bannerAssetIds"]}
                rules={detailBannerFormRules}
              >
                <DetailBannerField disabled={disabled} />
              </Form.Item>
          )}

          {configFields.has("richText") && (
            <Form.Item name={["detailPage", "richTextHtml"]} rules={richTextRules}>
              <RichTextEditorField disabled={disabled} />
            </Form.Item>
          )}

          <Space className="detail-page-actions" wrap>
            <Button
              data-testid="detail-page-template"
              disabled={disabled}
              loading={templateLoading}
              onClick={requestTemplate}
            >
              应用{template.label}
            </Button>
            <DetailPagePreview
              getDraft={buildDraft}
              ownerPreviewData={ownerPreviewData}
              disabled={disabled}
            />
          </Space>
        </div>
      )}
    </section>
  );
}
