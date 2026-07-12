import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Button, Card, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { firstValidationField, statusColor, statusLabel, type AnyRecord } from "../forms/form-utils";
import { useDirtyFormGuard } from "../forms/unsaved-changes";
import { request } from "../api";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { buildCrudSaveRequest, prepareCrudEditValues, type CrudConfig } from "./config";

type ListResponse = { items: AnyRecord[]; total?: number };
type SaveMode = "close" | "continue";

function searchableText(record: AnyRecord, fields: string[]) {
  return fields
    .flatMap((field) => {
      const value = record[field];
      if (Array.isArray(value)) {
        return value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
      }
      return ["string", "number", "boolean"].includes(typeof value) ? [value] : [];
    })
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

function pageNumber(value: string | null, fallback: number) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

export function CrudPage({ config }: { config: CrudConfig }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [dirty, setDirty] = useState(false);
  const hydrating = useRef(false);
  const clickGuard = useRepeatClickGuard();
  useDirtyFormGuard(`${config.testid}-drawer`, drawerOpen && dirty, "抽屉表单存在未保存修改，确认离开？");

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const category = searchParams.get("category") ?? "";
  const isFeatured = searchParams.get("isFeatured") ?? "";
  const page = pageNumber(searchParams.get("page"), 1);
  const pageSize = pageNumber(searchParams.get("pageSize"), 10);
  const breadcrumbGroup = config.formMode === "page" ? "内容管理" : "首页运营";

  async function load() {
    setLoading(true);
    try {
      const data = await request<ListResponse>(config.path);
      setItems(data.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [config.path]);

  function setFilter(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace: true });
  }

  const filteredItems = useMemo(() => {
    const normalizedQ = q.trim().toLocaleLowerCase("zh-CN");
    return items.filter((item) => {
      if (status && item.status !== status) return false;
      if (category && item.category !== category) return false;
      if (isFeatured && String(Boolean(item.isFeatured)) !== isFeatured) return false;
      if (normalizedQ && !searchableText(item, config.searchFields).includes(normalizedQ)) return false;
      return true;
    });
  }, [category, isFeatured, items, q, status]);

  function openCreate() {
    if (config.formMode === "page") {
      navigate(`${config.routePath}/new`, { state: { listSearch: searchParams.toString() } });
      return;
    }
    hydrating.current = true;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "enabled", sortOrder: 1, ...config.defaultValues });
    setDrawerOpen(true);
    setDirty(false);
    window.setTimeout(() => {
      hydrating.current = false;
    }, 0);
  }

  async function openEdit(record: AnyRecord) {
    if (config.formMode === "page") {
      navigate(`${config.routePath}/${record.id}/edit`, { state: { listSearch: searchParams.toString() } });
      return;
    }
    hydrating.current = true;
    setDrawerOpen(true);
    setLoading(true);
    try {
      const fullRecord = await request<AnyRecord>(`${config.path}/${record.id}`);
      setEditing(fullRecord);
      form.setFieldsValue(prepareCrudEditValues(fullRecord));
      setDirty(false);
    } catch (error) {
      setDrawerOpen(false);
      message.error(error instanceof Error ? error.message : "加载记录失败");
    } finally {
      setLoading(false);
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
    }
  }

  function closeDrawer() {
    if (dirty && !window.confirm("抽屉表单存在未保存修改，确认关闭？")) return;
    setDrawerOpen(false);
    setDirty(false);
  }

  async function save(values: AnyRecord, mode: SaveMode) {
    if (saving) return;
    setSaving(true);
    try {
      const saveRequest = buildCrudSaveRequest(config, editing, values);
      const saved = await request<AnyRecord>(saveRequest.path, {
        method: saveRequest.method,
        body: JSON.stringify(saveRequest.body)
      });
      message.success("保存成功");
      setDirty(false);
      await load();
      if (mode === "continue") {
        hydrating.current = true;
        setEditing(saved);
        form.setFieldsValue(prepareCrudEditValues(saved));
        window.setTimeout(() => {
          hydrating.current = false;
        }, 0);
      } else {
        setDrawerOpen(false);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function submit(mode: SaveMode) {
    try {
      const values = await form.validateFields();
      await save(values, mode);
    } catch (error) {
      const field = firstValidationField(error);
      if (field) form.scrollToField(field, { block: "center" });
    }
  }

  async function remove(record: AnyRecord) {
    const name = String(record.title ?? record.name ?? record.summary ?? record.text ?? `#${record.id}`);
    Modal.confirm({
      title: `确认删除「${name}」？`,
      content: `记录 ID：${record.id}。删除后该记录不会再出现在后台列表和前台页面；已关联的素材文件不会被删除。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk() {
        return clickGuard(`${config.testid}:delete-confirm:${record.id}`, async () => {
          await request(`${config.path}/${record.id}`, { method: "DELETE" });
          message.success("删除成功");
          await load();
        });
      }
    });
  }

  const columns: ColumnsType<AnyRecord> = [
    ...config.columns,
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
    },
    {
      title: "操作",
      width: 178,
      fixed: "right",
      render: (_, record) => (
        <Space>
          <Button data-testid={`${config.testid}-edit`} onClick={() => clickGuard(`${config.testid}:edit:${record.id}`, () => openEdit(record))}>
            编辑
          </Button>
          <Button danger data-testid={`${config.testid}-delete`} onClick={() => clickGuard(`${config.testid}:delete:${record.id}`, () => remove(record))}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title={config.title}
        breadcrumbs={[breadcrumbGroup, config.title]}
        extra={<Button data-testid={`${config.testid}-create`} type="primary" onClick={() => clickGuard(`${config.testid}:create`, openCreate)}>新增</Button>}
      />
      <Card className="list-card">
        <Space className="list-toolbar" wrap>
          <Input.Search
            data-testid={`${config.testid}-search`}
            allowClear
            placeholder={config.searchPlaceholder}
            value={q}
            onChange={(event) => setFilter({ q: event.target.value, page: undefined })}
          />
          <Select
            data-testid={`${config.testid}-status-filter`}
            allowClear
            placeholder="全部状态"
            value={status || undefined}
            onChange={(value) => setFilter({ status: value, page: undefined })}
            options={[
              { value: "enabled", label: "启用" },
              { value: "disabled", label: "停用" }
            ]}
            style={{ width: 160 }}
          />
          {config.toolbarFilters?.({ category, isFeatured, q, status }, setFilter)}
          <Button onClick={() => clickGuard(`${config.testid}:filters:clear`, () => setSearchParams(new URLSearchParams(), { replace: true }))}>清空筛选</Button>
        </Space>
        <Table
          data-testid={`${config.testid}-table`}
          rowKey="id"
          loading={loading}
          dataSource={filteredItems}
          columns={columns}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <Empty description={q || status || category || isFeatured ? "没有符合条件的记录" : "暂无数据"} /> }}
          pagination={{
            current: page,
            pageSize,
            total: filteredItems.length,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => clickGuard(`${config.testid}:pagination:${nextPage}:${nextPageSize}`, () => setFilter({ page: String(nextPage), pageSize: String(nextPageSize) }))
          }}
          onRow={(record) => ({
            "data-testid": `${config.testid}-row-${record.id}`
          } as unknown as React.HTMLAttributes<HTMLTableRowElement>)}
        />
      </Card>
      {config.formMode !== "drawer" && <Form form={form} component={false} />}
      {config.formMode === "drawer" && (
        <Drawer
          data-testid={`${config.testid}-drawer`}
          title={editing ? `编辑${config.title}` : `新增${config.title}`}
          open={drawerOpen}
          size={(config.drawerWidth ?? 560) > 560 ? "large" : "default"}
          onClose={closeDrawer}
          footer={
            <div className="drawer-footer">
              <Button onClick={() => clickGuard(`${config.testid}:drawer:close`, closeDrawer)}>取消</Button>
              <Space>
                <Button data-testid={`${config.testid}-save-continue`} loading={saving} disabled={saving} onClick={() => clickGuard(`${config.testid}:save:continue`, () => submit("continue"))}>保存并继续</Button>
                <Button data-testid={`${config.testid}-save`} type="primary" loading={saving} disabled={saving} onClick={() => clickGuard(`${config.testid}:save:close`, () => submit("close"))}>保存</Button>
              </Space>
            </div>
          }
        >
          <Form
            data-testid={`${config.testid}-form`}
            form={form}
            layout="vertical"
            onValuesChange={() => {
              if (!hydrating.current) setDirty(true);
            }}
            initialValues={{ status: "enabled", sortOrder: 1 }}
          >
            {config.fields(form, editing)}
          </Form>
        </Drawer>
      )}
    </div>
  );
}
