import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Skeleton, message } from "antd";
import { flushSync } from "react-dom";
import { PageHeader } from "../components/PageHeader";
import { FormActionBar } from "../components/FormActionBar";
import { FormSection } from "../components/FormSection";
import { firstValidationField, type AnyRecord } from "../forms/form-utils";
import { useDirtyFormGuard } from "../forms/unsaved-changes";
import { MediaField } from "../media/MediaField";
import { request } from "../api";

export function SiteConfigPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydrating = useRef(true);
  useDirtyFormGuard("site-config", dirty);

  async function load() {
    setLoading(true);
    setError(null);
    hydrating.current = true;
    try {
      const data = await request<AnyRecord>("/api/admin/site-config");
      flushSync(() => {
        setLoading(false);
      });
      form.setFieldsValue(data ?? {});
      setDirty(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
      setLoading(false);
    } finally {
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(values: AnyRecord) {
    setSaving(true);
    try {
      await request("/api/admin/site-config", { method: "PUT", body: JSON.stringify(values) });
      setDirty(false);
      message.success("保存成功");
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    try {
      const values = await form.validateFields();
      await save(values);
    } catch (submitError) {
      const field = firstValidationField(submitError);
      if (field) form.scrollToField(field, { block: "center" });
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="首页配置" breadcrumbs={["首页运营", "首页配置"]} />
      {error ? (
        <Alert
          type="error"
          showIcon
          message="首页配置加载失败"
          description={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      ) : (
        <Skeleton loading={loading} active>
          <Form
            form={form}
            layout="vertical"
            onValuesChange={() => {
              if (!hydrating.current) setDirty(true);
            }}
          >
            <FormSection title="基础信息">
              <Form.Item label="小程序名" name="appName" rules={[{ required: true, message: "请输入小程序名" }]}>
                <Input data-testid="site-app-name" />
              </Form.Item>
              <Form.Item label="副标题" name="subtitle" rules={[{ required: true, message: "请输入副标题" }]}>
                <Input data-testid="site-subtitle" />
              </Form.Item>
            </FormSection>
            <FormSection title="默认素材">
              <Form.Item label="默认 Banner 图" name="defaultBannerAssetId">
                <MediaField testid="site-default-banner-select" fieldKey="site.defaultBanner" />
              </Form.Item>
              <Form.Item label="Banner 占位图" name="placeholderBannerAssetId">
                <MediaField testid="site-placeholder-banner-select" fieldKey="site.placeholderBanner" />
              </Form.Item>
              <Form.Item label="菜单图标占位图" name="placeholderIconAssetId">
                <MediaField testid="site-placeholder-icon-select" fieldKey="site.placeholderIcon" />
              </Form.Item>
              <Form.Item label="案例封面占位图" name="placeholderCaseAssetId">
                <MediaField testid="site-placeholder-case-select" fieldKey="site.placeholderCase" />
              </Form.Item>
            </FormSection>
            <FormActionBar saving={saving} saveTestid="site-save" onSave={() => void submit()} />
          </Form>
        </Skeleton>
      )}
    </div>
  );
}
