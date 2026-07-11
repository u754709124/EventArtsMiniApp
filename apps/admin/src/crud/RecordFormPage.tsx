import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Skeleton, message } from "antd";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { FormActionBar } from "../components/FormActionBar";
import { FormSection } from "../components/FormSection";
import { firstValidationField, type AnyRecord } from "../forms/form-utils";
import { useDirtyFormGuard } from "../forms/unsaved-changes";
import { request } from "../api";
import { buildCrudSaveRequest, prepareCrudEditValues, type CrudConfig } from "./config";

export function RecordFormPage({ config }: { config: CrudConfig }) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();
  const id = params.id ? Number(params.id) : null;
  const isNew = !id;
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const hydrating = useRef(true);
  const dirtyGuardKey = `${config.testid}-page-form`;
  const dirtyGuard = useDirtyFormGuard(dirtyGuardKey, dirty, "当前表单存在未保存修改，确认离开？");

  const listSearch = typeof location.state === "object" && location.state && "listSearch" in location.state
    ? String((location.state as { listSearch?: unknown }).listSearch ?? "")
    : "";
  const listUrl = `${config.routePath}${listSearch ? `?${listSearch}` : ""}`;

  async function load() {
    if (isNew) {
      hydrating.current = true;
      form.resetFields();
      form.setFieldsValue({ status: "enabled", sortOrder: 1, isFeatured: false, featuredSortOrder: 1, detailPageId: null });
      setDirty(false);
      setLoading(false);
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
      return;
    }
    setLoading(true);
    setError(null);
    hydrating.current = true;
    try {
      const record = await request<AnyRecord>(`${config.path}/${id}`);
      flushSync(() => {
        setEditing(record);
        setLoading(false);
      });
      form.setFieldsValue(prepareCrudEditValues(record));
      setDirty(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载记录失败");
      setLoading(false);
    } finally {
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
    }
  }

  useEffect(() => {
    void load();
  }, [id, isNew]);

  function backToList() {
    navigate(listUrl);
  }

  async function persist(values: AnyRecord) {
    const saveRequest = buildCrudSaveRequest(config, editing, values);
    const saved = await request<AnyRecord>(saveRequest.path, {
      method: saveRequest.method,
      body: JSON.stringify(saveRequest.body)
    });
    flushSync(() => {
      setDirty(false);
      dirtyGuard.clearDirtyEntry(dirtyGuardKey);
    });
    message.success("保存成功");
    return saved;
  }

  async function submit(mode: "return" | "continue") {
    if (saving) return;
    setSaving(true);
    try {
      const values = await form.validateFields();
      const saved = await persist(values);
      if (mode === "return") {
        backToList();
        return;
      }
      if (isNew && saved.id) {
        navigate(`${config.routePath}/${saved.id}/edit`, { replace: true, state: { listSearch } });
        return;
      }
      setEditing(saved);
      form.setFieldsValue(prepareCrudEditValues(saved));
    } catch (submitError) {
      const field = firstValidationField(submitError);
      if (field) form.scrollToField(field, { block: "center" });
      else message.error(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.isComposing) {
        event.preventDefault();
        void submit("continue");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const pageTitle = isNew ? `新增${config.title}` : `编辑${config.title}`;

  return (
    <div className="page-stack">
      <PageHeader title={pageTitle} breadcrumbs={["内容管理", config.title, isNew ? "新增" : "编辑"]} />
      {error ? (
        <Alert
          type="error"
          showIcon
          message="记录加载失败"
          description={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      ) : (
        <Skeleton loading={loading} active>
          <Form
            data-testid={`${config.testid}-form`}
            form={form}
            layout="vertical"
            onValuesChange={() => {
              if (!hydrating.current) setDirty(true);
            }}
            initialValues={{ status: "enabled", sortOrder: 1, isFeatured: false, featuredSortOrder: 1, detailPageId: null }}
          >
            {(config.sections ?? [{ title: "基础信息", fields: config.fields }]).map((section) => (
              <FormSection key={section.title} title={section.title} description={section.description}>
                {section.fields(form, editing)}
              </FormSection>
            ))}
            <FormActionBar
              saving={saving}
              saveText="保存并返回"
              saveTestid={`${config.testid}-save`}
              continueText="保存并继续"
              continueTestid={`${config.testid}-save-continue`}
              onReturn={backToList}
              onSave={() => void submit("return")}
              onSaveAndContinue={() => void submit("continue")}
            />
          </Form>
        </Skeleton>
      )}
    </div>
  );
}
