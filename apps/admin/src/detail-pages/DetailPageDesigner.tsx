import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Form, Input, Select, Space, Spin, Tag } from "antd";
import type { DetailPageConfigDto, DetailPageReferenceDto, DetailPageType } from "@event-arts/shared";
import { DetailPageTypeSchema, detailPageTypeDefinitions } from "@event-arts/shared";
import { flushSync } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { request } from "../api";
import { FormActionBar } from "../components/FormActionBar";
import { PageHeader } from "../components/PageHeader";
import { useDirtyFormGuard } from "../forms/unsaved-changes";
import { withAdminBasename } from "../routes/admin-paths";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { notify } from "../notifications/notification";
import { DetailBannerField, detailBannerFormRules } from "./DetailBannerField";
import { DetailPageLivePreview } from "./DetailPageLivePreview";
import { DetailPageTypeSelect } from "./DetailPageTypeSelect";
import { RichTextEditorField } from "./RichTextEditorField";
import {
  detailPageDtoToStandaloneFormValue,
  isMeaningfulRichText,
  normalizeStandaloneDetailPageFormValue
} from "./detail-page-form-utils";
import type { StandaloneDetailPageFormValue } from "./types";
import "./detail-page-designer.css";

declare global {
  interface Window {
    __eventartsDetailPageDirty?: boolean;
  }
}

const richTextRules = [
  {
    validator: (_rule: unknown, value: unknown) =>
      isMeaningfulRichText(value)
        ? Promise.resolve()
        : Promise.reject(new Error("请填写详情页富文本"))
  }
];

export function referencePath(reference: DetailPageReferenceDto) {
  if (reference.sourceType === "announcement") return "/announcements";
  if (reference.sourceType === "banner") return "/banners";
  if (reference.sourceType === "artist") return "/artists";
  if (reference.sourceType === "article") return "/articles";
  if (reference.sourceType === "recent_activity") return "/recent-activities";
  if (reference.sourceType === "menu") return "/menu-items";
  return "/cases";
}

export function DetailPageDesigner() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const requestedTypeResult = DetailPageTypeSchema.safeParse(searchParams.get("type"));
  const requestedType = requestedTypeResult.success ? requestedTypeResult.data : undefined;
  const editingId = params.id ? Number(params.id) : null;
  const isNew = !editingId;
  const [form] = Form.useForm<StandaloneDetailPageFormValue>();
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(isNew ? "尚未保存" : "已保存");
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<DetailPageConfigDto | null>(null);
  const hydrating = useRef(true);
  const watchedType = Form.useWatch(["detailPage", "type"], form) as DetailPageType | undefined;
  const bannerAssetIds = Form.useWatch(["detailPage", "bannerAssetIds"], form) as number[] | undefined;
  const references = detail?.references ?? [];
  const returnToken = searchParams.get("returnToken");
  const dirtyGuardKey = "detail-page-designer";
  const dirtyGuard = useDirtyFormGuard(dirtyGuardKey, dirty, "详情页设计器存在未保存修改，确认离开？");
  const clickGuard = useRepeatClickGuard();

  useEffect(() => {
    hydrating.current = true;
    if (isNew) {
      form.resetFields();
      if (requestedType) form.setFieldValue(["detailPage", "type"], requestedType);
      setDetail(null);
      setLoading(false);
      setDirty(false);
      setSaveStatus("尚未保存");
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
      return;
    }
    setLoading(true);
    request<DetailPageConfigDto>(`/api/admin/detail-pages/${editingId}`)
      .then((data) => {
        setDetail(data);
        form.setFieldsValue(detailPageDtoToStandaloneFormValue(data));
        setDirty(false);
        setSaveStatus("已保存");
        setRevision((value) => value + 1);
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : "详情页加载失败"))
      .finally(() => {
        setLoading(false);
        window.setTimeout(() => {
          hydrating.current = false;
        }, 0);
      });
  }, [editingId, form, isNew, requestedType]);

  useEffect(() => {
    window.__eventartsDetailPageDirty = dirty;
    return () => {
      window.__eventartsDetailPageDirty = false;
    };
  }, [dirty]);

  const configFields = useMemo(() => watchedType ? new Set(detailPageTypeDefinitions[watchedType].configFields) : new Set(), [watchedType]);

  function markDirty() {
    if (hydrating.current) return;
    setDirty(true);
    setSaveStatus("有未保存修改");
    setRevision((value) => value + 1);
  }

  function getDraft() {
    return normalizeStandaloneDetailPageFormValue(form.getFieldsValue(true));
  }

  function goBack() {
    if (!dirtyGuard.confirmIfDirty()) return;
    navigate("/detail-pages");
  }

  function notifyReturn(id: number) {
    if (!returnToken) return;
    try {
      const channel = new BroadcastChannel("eventarts-detail-page-reference");
      channel.postMessage({ token: returnToken, id });
      channel.close();
    } catch {
      window.opener?.postMessage?.({ token: returnToken, id }, window.location.origin);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveStatus("保存中");
    try {
      await form.validateFields();
      const body = getDraft();
      const saved = await request<DetailPageConfigDto>(isNew ? "/api/admin/detail-pages" : `/api/admin/detail-pages/${editingId}`, {
        method: isNew ? "POST" : "PUT",
        body: JSON.stringify(body)
      });
      hydrating.current = true;
      form.setFieldsValue(detailPageDtoToStandaloneFormValue(saved));
      setDetail(saved);
      flushSync(() => {
        setDirty(false);
        dirtyGuard.clearDirtyEntry(dirtyGuardKey);
      });
      setSaveStatus("已保存");
      setRevision((value) => value + 1);
      notifyReturn(saved.id);
      notify.success("保存成功");
      if (isNew) navigate(`/detail-pages/${saved.id}/edit${returnToken ? `?returnToken=${encodeURIComponent(returnToken)}` : ""}`, { replace: true });
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
    } catch (error) {
      setSaveStatus("保存失败");
      notify.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack" data-testid="detail-page-designer">
      <PageHeader title={isNew ? "新建详情页" : "编辑详情页"} breadcrumbs={["内容管理", "详情页管理", isNew ? "新建" : "编辑"]} />
      <div className="detail-designer">
        <div className="detail-designer__preview">
          <DetailPageLivePreview revision={revision} getDraft={getDraft} />
        </div>
        <Card className="detail-designer__panel">
        <Spin spinning={loading}>
          <Form
            form={form}
            layout="vertical"
            onValuesChange={markDirty}
            initialValues={{ detailPage: { hero: { tags: [], metaItems: [] } } }}
          >
            <Form.Item label="详情页 ID">
              <Input data-testid="detail-page-id" value={detail?.id ? String(detail.id) : "保存后自动生成"} disabled />
            </Form.Item>
            <Form.Item label="详情页名称" name="name" rules={[{ required: true, whitespace: true, message: "请输入详情页名称" }]}>
              <Input data-testid="detail-page-name" maxLength={100} showCount />
            </Form.Item>
            <Form.Item label="详情页类型" name={["detailPage", "type"]} rules={[{ required: true, message: "请选择详情页类型" }]}>
              <DetailPageTypeSelect
                bannerAssetIds={bannerAssetIds}
                getBannerAssetIds={() => form.getFieldValue(["detailPage", "bannerAssetIds"]) as number[] | undefined}
              />
            </Form.Item>

            {!watchedType ? (
              <div className="detail-page-empty-hint">请先选择详情页类型</div>
            ) : (
              <>
                {configFields.has("heroTitle") && (
                  <Form.Item label="BANNER 主标题" name={["detailPage", "hero", "title"]} rules={[{ required: true, whitespace: true, message: "请输入 BANNER 主标题" }]}>
                    <Input data-testid="detail-hero-title" maxLength={80} showCount />
                  </Form.Item>
                )}
                {configFields.has("heroTypeLabel") && (
                  <Form.Item label="类型/辅助标题" name={["detailPage", "hero", "typeLabel"]}>
                    <Input data-testid="detail-hero-type-label" maxLength={80} showCount />
                  </Form.Item>
                )}
                {configFields.has("heroSubtitle") && (
                  <Form.Item label="宣传语（选填）" name={["detailPage", "hero", "subtitle"]}>
                    <Input data-testid="detail-hero-subtitle" maxLength={80} showCount />
                  </Form.Item>
                )}
                {configFields.has("heroBadge") && (
                  <Form.Item label="主标签" name={["detailPage", "hero", "badge"]}>
                    <Input data-testid="detail-hero-badge" maxLength={80} showCount />
                  </Form.Item>
                )}
                {configFields.has("heroTags") && (
                  <Form.Item label="多个标签" name={["detailPage", "hero", "tags"]}>
                    <Select data-testid="detail-hero-tags" mode="tags" tokenSeparators={[",", "，"]} />
                  </Form.Item>
                )}
                {configFields.has("heroLocation") && (
                  <Form.Item label="地点" name={["detailPage", "hero", "location"]}>
                    <Input data-testid="detail-hero-location" maxLength={30} showCount />
                  </Form.Item>
                )}
                {configFields.has("heroMetaItems") && (
                  <Form.List name={["detailPage", "hero", "metaItems"]}>
                    {(fields, { add, remove }) => (
                      <div className="detail-meta-list">
                        <label>其他元数据</label>
                        {fields.map((field) => (
                          <Space key={field.key} align="baseline" className="detail-meta-row">
                            <Form.Item {...field} name={[field.name, "label"]} rules={[{ required: true, message: "名称" }]}>
                              <Input placeholder="名称" />
                            </Form.Item>
                            <Form.Item {...field} name={[field.name, "value"]} rules={[{ required: true, message: "内容" }]}>
                              <Input placeholder="内容" />
                            </Form.Item>
                            <Button onClick={() => remove(field.name)}>删除</Button>
                          </Space>
                        ))}
                        <Button onClick={() => add()}>新增元数据</Button>
                      </div>
                    )}
                  </Form.List>
                )}
                {configFields.has("banners") && (
                  <Form.Item label="BANNER 多图及排序" name={["detailPage", "bannerAssetIds"]} rules={detailBannerFormRules}>
                    <DetailBannerField />
                  </Form.Item>
                )}
                {configFields.has("richText") && (
                  <Form.Item label="富文本编辑器" name={["detailPage", "richTextHtml"]} rules={richTextRules}>
                    <RichTextEditorField />
                  </Form.Item>
                )}
              </>
            )}
          </Form>
        </Spin>
        {detail && (
          <section className="detail-references">
            <h3>被引用 {references.length} 次</h3>
            {references.length === 0 ? (
              <p>暂无业务内容引用</p>
            ) : (
              <Space wrap>
                {references.map((reference) => (
                  <Button key={`${reference.sourceType}-${reference.sourceId}`} onClick={() => clickGuard(`detail-reference:${reference.sourceType}:${reference.sourceId}`, () => window.open(withAdminBasename(referencePath(reference)), "_blank", "noopener"))}>
                    <Tag>{reference.sourceType}</Tag> #{reference.sourceId} {reference.sourceName}
                  </Button>
                ))}
              </Space>
            )}
          </section>
        )}
        <FormActionBar
          saving={saving}
          saveTestid="detail-designer-save"
          onReturn={goBack}
          onSave={() => void save()}
          extra={
            <span className="detail-designer__save-status" data-testid="detail-designer-save-status" role="status" aria-live="polite">
              {saveStatus}
            </span>
          }
        />
      </Card>
      </div>
    </div>
  );
}
