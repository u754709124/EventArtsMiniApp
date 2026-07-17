import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Skeleton, Typography } from "antd";
import type { EdgeOneConfigResponse, EdgeOneConfigUpdateRequest } from "@event-arts/shared";
import { ApiError, request } from "../api";
import { FormActionBar } from "../components/FormActionBar";
import { FormSection } from "../components/FormSection";
import { PageHeader } from "../components/PageHeader";
import { firstValidationField } from "../forms/form-utils";
import { useDirtyFormGuard } from "../forms/unsaved-changes";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { notify } from "../notifications/notification";

type EdgeOneConfigFormValues = {
  zoneId: string;
  secretId?: string;
  secretKey?: string;
};

export function SystemConfigPage() {
  const [form] = Form.useForm<EdgeOneConfigFormValues>();
  const [config, setConfig] = useState<EdgeOneConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const clickGuard = useRepeatClickGuard();
  useDirtyFormGuard("edgeone-system-config", dirty);

  async function loadConfig() {
    const requestSequence = ++requestSequenceRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await request<EdgeOneConfigResponse>("/api/admin/system-config/edgeone");
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
      setConfig(next);
    } catch (error) {
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
      setLoadError(error instanceof Error ? error.message : "EdgeOne 配置加载失败");
    } finally {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadConfig();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !config) return;
    form.setFieldsValue({
      zoneId: config.zoneId ?? "",
      secretId: "",
      secretKey: ""
    });
    setDirty(false);
  }, [config, form, loading]);

  function requiredCredentialRule(field: "secretId" | "secretKey", label: string) {
    return {
      validator: (_: unknown, value: string | undefined) => {
        const alreadyConfigured = field === "secretId" ? config?.secretIdConfigured : config?.secretKeyConfigured;
        if (alreadyConfigured || value) return Promise.resolve();
        return Promise.reject(new Error(`首次配置请输入 ${label}`));
      }
    };
  }

  async function save(values: EdgeOneConfigFormValues) {
    setSaving(true);
    setSubmitError(null);
    form.setFields([{ name: "zoneId", errors: [] }]);
    const payload: EdgeOneConfigUpdateRequest = { zoneId: values.zoneId.trim() };
    if (values.secretId) payload.secretId = values.secretId;
    if (values.secretKey) payload.secretKey = values.secretKey;

    try {
      const next = await request<EdgeOneConfigResponse>("/api/admin/system-config/edgeone", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      if (!mountedRef.current) return;
      setConfig(next);
      form.setFieldsValue({ zoneId: next.zoneId ?? "", secretId: "", secretKey: "" });
      setDirty(false);
      notify.success("EdgeOne 配置验证并保存成功");
    } catch (error) {
      if (!mountedRef.current) return;
      const errorMessage = error instanceof Error ? error.message : "EdgeOne 配置保存失败";
      if (error instanceof ApiError && error.code === "EDGEONE_ZONE_NOT_FOUND") {
        form.setFields([{ name: "zoneId", errors: [errorMessage] }]);
        form.scrollToField("zoneId", { block: "center" });
      } else {
        setSubmitError(errorMessage);
      }
      notify.error("验证失败，当前配置未被覆盖");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function submit() {
    try {
      const values = await form.validateFields();
      await save(values);
    } catch (error) {
      const field = firstValidationField(error);
      if (field) form.scrollToField(field, { block: "center" });
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="系统配置"
        breadcrumbs={["系统配置"]}
        description="配置服务端访问腾讯云 EdgeOne 所需的 ZoneId 与最小权限 CAM 子账号凭证。"
      />
      {loadError ? (
        <Alert
          data-testid="edgeone-config-load-error"
          type="error"
          showIcon
          title="EdgeOne 配置加载失败"
          description={loadError}
          action={<Button onClick={() => clickGuard("edgeone-config:retry", loadConfig)}>重试</Button>}
        />
      ) : (
        <Skeleton loading={loading} active>
          <Form
            className="system-config-form"
            data-testid="edgeone-config-form"
            form={form}
            initialValues={{
              zoneId: config?.zoneId ?? "",
              secretId: "",
              secretKey: ""
            }}
            layout="vertical"
            autoComplete="off"
            onValuesChange={() => setDirty(true)}
          >
            <FormSection
              title="EdgeOne"
              description="保存时会先验证 CAM 凭证、查询权限、Zone 归属和套餐信息；验证失败不会覆盖当前配置。"
            >
              {submitError && (
                <Alert
                  className="form-grid-full"
                  data-testid="edgeone-config-submit-error"
                  type="error"
                  showIcon
                  title="EdgeOne 配置验证失败"
                  description={submitError}
                />
              )}
              <Form.Item
                label="ZoneId"
                name="zoneId"
                rules={[
                  { required: true, whitespace: true, message: "请输入 ZoneId" },
                  { max: 128, message: "ZoneId 不能超过 128 个字符" },
                  { pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/, message: "ZoneId 格式不正确" }
                ]}
                extra="EdgeOne 控制台中的站点 ID，例如 zone-xxxxxxxx。"
              >
                <Input data-testid="edgeone-zone-id" spellCheck={false} />
              </Form.Item>
              <Form.Item
                label="CAM SecretId"
                name="secretId"
                rules={[requiredCredentialRule("secretId", "SecretId")]}
                extra={config?.secretIdConfigured
                  ? `已配置${config.secretIdMasked ? `（${config.secretIdMasked}）` : ""}，留空保持不变。`
                  : "首次配置必填；保存成功后不会再次回显。"}
              >
                <Input.Password
                  data-testid="edgeone-secret-id"
                  autoComplete="off"
                  maxLength={128}
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item
                label="CAM SecretKey"
                name="secretKey"
                rules={[requiredCredentialRule("secretKey", "SecretKey")]}
                extra={config?.secretKeyConfigured
                  ? "已配置，留空保持不变。"
                  : "首次配置必填；密钥仅用于本次提交，不会回显。"}
              >
                <Input.Password
                  data-testid="edgeone-secret-key"
                  autoComplete="new-password"
                  maxLength={512}
                  spellCheck={false}
                />
              </Form.Item>
              <Typography.Paragraph className="form-grid-full system-config-security-note" type="secondary">
                凭证只发送到本服务端并以 AES-256-GCM 密文保存；请仅授予 DescribePlans 和目标 Zone 的 DescribeBillingData 权限。
              </Typography.Paragraph>
            </FormSection>
            <FormActionBar
              saving={saving}
              saveText="验证并保存"
              saveTestid="edgeone-config-save"
              onSave={() => void submit()}
            />
          </Form>
        </Skeleton>
      )}
    </div>
  );
}
