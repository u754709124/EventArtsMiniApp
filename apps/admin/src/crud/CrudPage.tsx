import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { MenuOutlined } from "@ant-design/icons";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Card, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, message } from "antd";
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
const sortablePageSize = 100;
type SortableRowContextValue = {
  enabled: boolean;
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  attributes: Record<string, unknown>;
  listeners?: Record<string, (event: Event) => void>;
};

const SortableRowContext = createContext<SortableRowContextValue>({ enabled: false, attributes: {} });

function SortableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { "data-row-key"?: string }) {
  const rowId = Number(props["data-row-key"]);
  const table = useContext(SortableTableContext);
  const sort = useSortable({ id: rowId, disabled: !table.enabled || !Number.isSafeInteger(rowId) });
  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(sort.transform),
    transition: sort.transition,
    ...(sort.isDragging ? { position: "relative", zIndex: 2 } : {})
  };
  return (
    <SortableRowContext.Provider
      value={{
        enabled: table.enabled,
        setActivatorNodeRef: sort.setActivatorNodeRef,
        attributes: sort.attributes as unknown as Record<string, unknown>,
        listeners: sort.listeners as Record<string, (event: Event) => void> | undefined
      }}
    >
      <tr {...props} ref={sort.setNodeRef} style={style} />
    </SortableRowContext.Provider>
  );
}

const SortableTableContext = createContext<{ enabled: boolean }>({ enabled: false });

function DragHandle({ disabled }: { disabled: boolean }) {
  const row = useContext(SortableRowContext);
  const effectiveDisabled = disabled || !row.enabled;
  return (
    <Tooltip title={effectiveDisabled ? "清空筛选后可拖拽排序" : "拖拽排序"}>
      <Button
        className="crud-drag-handle"
        type="text"
        size="small"
        icon={<MenuOutlined />}
        aria-label="拖拽排序"
        disabled={effectiveDisabled}
        ref={row.setActivatorNodeRef}
        {...(!effectiveDisabled ? row.attributes : {})}
        {...(!effectiveDisabled ? row.listeners : {})}
      />
    </Tooltip>
  );
}

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

function recordId(record: AnyRecord) {
  return Number(record.id);
}

function listPath(path: string, query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
}

export function CrudPage({ config }: { config: CrudConfig }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [listTotal, setListTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
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
      if (!config.sortable) {
        const data = await request<ListResponse>(config.path);
        setItems(data.items);
        setListTotal(data.total ?? data.items.length);
        return;
      }
      const first = await request<ListResponse>(listPath(config.path, { page: "1", pageSize: String(sortablePageSize) }));
      const total = first.total ?? first.items.length;
      const allItems = [...first.items];
      for (let nextPage = 2; allItems.length < total; nextPage += 1) {
        const next = await request<ListResponse>(listPath(config.path, { page: String(nextPage), pageSize: String(sortablePageSize) }));
        if (!next.items.length) break;
        allItems.push(...next.items);
      }
      setItems(allItems);
      setListTotal(total);
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
  const hasLoadedFullSortableList = listTotal === null || items.length >= listTotal;
  const sortableEnabled = Boolean(config.sortable && hasLoadedFullSortableList && !q && !status && !category && !isFeatured && filteredItems.length > 1);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function resetCreateDrawer() {
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

  function openCreate() {
    if (config.formMode === "page") {
      navigate(`${config.routePath}/new`, { state: { listSearch: searchParams.toString() } });
      return;
    }
    resetCreateDrawer();
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
    const wasCreating = editing === null;
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
        if (wasCreating) {
          resetCreateDrawer();
        } else {
          hydrating.current = true;
          setEditing(saved);
          form.setFieldsValue(prepareCrudEditValues(saved));
          window.setTimeout(() => {
            hydrating.current = false;
          }, 0);
        }
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

  async function reorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!sortableEnabled || !over || active.id === over.id || reordering) return;
    const from = items.findIndex((item) => recordId(item) === Number(active.id));
    const to = items.findIndex((item) => recordId(item) === Number(over.id));
    if (from < 0 || to < 0) return;
    const previous = items;
    const nextItems = arrayMove(items, from, to).map((item, index) => ({ ...item, sortOrder: index + 1 }));
    setItems(nextItems);
    setReordering(true);
    try {
      await request(`${config.path}/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids: nextItems.map(recordId) })
      });
      message.success("排序已保存");
      await load();
    } catch (error) {
      setItems(previous);
      message.error(error instanceof Error ? error.message : "排序保存失败");
    } finally {
      setReordering(false);
    }
  }

  const statusColumn: ColumnsType<AnyRecord>[number] = {
    title: "状态",
    dataIndex: "status",
    width: 100,
    render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
  };
  const dragColumn: ColumnsType<AnyRecord>[number] = {
    title: "",
    key: "drag",
    width: 52,
    fixed: "left",
    render: () => <DragHandle disabled={!sortableEnabled || reordering} />
  };
  const columns: ColumnsType<AnyRecord> = [
    ...(config.sortable ? [dragColumn] : []),
    statusColumn,
    ...config.columns,
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
          <SortableContext items={filteredItems.map(recordId)} strategy={verticalListSortingStrategy}>
            <SortableTableContext.Provider value={{ enabled: sortableEnabled && !reordering }}>
              <Table
          data-testid={`${config.testid}-table`}
          rowKey="id"
          loading={loading || reordering}
          dataSource={filteredItems}
          columns={columns}
          components={config.sortable ? { body: { row: SortableRow } } : undefined}
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
            </SortableTableContext.Provider>
          </SortableContext>
        </DndContext>
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
