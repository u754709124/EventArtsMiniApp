import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  message
} from "antd";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ColumnsType } from "antd/es/table";
import {
  DashboardOutlined,
  FileImageOutlined,
  LogoutOutlined,
  MenuOutlined,
  NotificationOutlined,
  PictureOutlined,
  SettingOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  artistTypeValues,
  artistTypeLabels,
  bannerLinkTypeValues,
  statusValues,
  type DashboardOverviewResponse,
  type DetailPageConfigDto,
  type MenuType
} from "@event-arts/shared";
import { clearToken, getToken, request, setToken } from "./api";
import { DetailPageConfigFields } from "./detail-pages/DetailPageConfigFields";
import {
  detailPageConfigDtoToFormValue,
  normalizeDetailPageFormValue
} from "./detail-pages/detail-page-form-utils";
import { MediaField } from "./media/MediaField";
import { MediaPage } from "./media/MediaPage";
import "./styles.css";

type AnyRecord = Record<string, unknown>;

function normalizeArtistFormTags(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  const seen = new Set<string>();
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase("zh-CN");
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const data = await request<{ token: string }>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      setToken(data.token);
      message.success("登录成功");
      navigate("/dashboard");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <Card className="login-card" title="后台管理系统">
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input data-testid="login-username" autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password data-testid="login-password" autoComplete="current-password" />
          </Form.Item>
          <Button data-testid="login-submit" type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const navItems = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "数据看板", testid: "sidebar-dashboard" },
  { key: "/site-config", icon: <SettingOutlined />, label: "首页配置", testid: "sidebar-site-config" },
  { key: "/announcements", icon: <NotificationOutlined />, label: "公告管理", testid: "sidebar-announcements" },
  { key: "/banners", icon: <PictureOutlined />, label: "Banner 管理", testid: "sidebar-banners" },
  { key: "/menu-items", icon: <MenuOutlined />, label: "菜单管理", testid: "sidebar-menu-items" },
  { key: "/cases", icon: <FileImageOutlined />, label: "案例管理", testid: "sidebar-cases" },
  { key: "/artists", icon: <TeamOutlined />, label: "人员管理", testid: "sidebar-artists" },
  { key: "/media-assets", icon: <FileImageOutlined />, label: "资源管理", testid: "sidebar-media-assets" }
];

function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <Layout className="admin-layout">
      <Layout.Sider width={232} theme="light">
        <div className="brand">喜缘 CMS</div>
        <Menu
          selectedKeys={[location.pathname]}
          mode="inline"
          items={navItems.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: <span data-testid={item.testid}>{item.label}</span>
          }))}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="admin-header">
          <span>EventArtsMiniApp</span>
          <Button data-testid="logout-button" icon={<LogoutOutlined />} onClick={logout}>
            退出登录
          </Button>
        </Layout.Header>
        <Layout.Content className="admin-content">{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}

function DashboardPage() {
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request<DashboardOverviewResponse>("/api/admin/dashboard/overview")
      .then(setData)
      .catch((error) => message.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin />;
  return (
    <Space size={16} wrap>
      <Card className="metric-card" data-testid="dashboard-pv-today" title="今日浏览人次">
        <strong>{data?.todayPv ?? 0}</strong>
      </Card>
      <Card className="metric-card" data-testid="dashboard-pv-week" title="本周浏览人次">
        <strong>{data?.weekPv ?? 0}</strong>
      </Card>
      <Card className="metric-card" data-testid="dashboard-pv-month" title="本月浏览人次">
        <strong>{data?.monthPv ?? 0}</strong>
      </Card>
    </Space>
  );
}

function SiteConfigPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request<AnyRecord>("/api/admin/site-config")
      .then((data) => form.setFieldsValue(data ?? {}))
      .finally(() => setLoading(false));
  }, [form]);

  async function save(values: AnyRecord) {
    try {
      await request("/api/admin/site-config", { method: "PUT", body: JSON.stringify(values) });
      message.success("保存成功");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  return (
    <Card title="首页配置">
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item label="小程序名" name="appName" rules={[{ required: true }]}>
            <Input data-testid="site-app-name" />
          </Form.Item>
          <Form.Item label="副标题" name="subtitle" rules={[{ required: true }]}>
            <Input data-testid="site-subtitle" />
          </Form.Item>
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
          <Button data-testid="site-save" type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Spin>
    </Card>
  );
}

type CrudConfig = {
  title: string;
  path: string;
  testid: string;
  columns: ColumnsType<AnyRecord>;
  fields: (form: ReturnType<typeof Form.useForm>[0], editing: AnyRecord | null) => React.ReactNode;
  normalize?: (values: AnyRecord) => AnyRecord;
  drawerWidth?: number;
};

export function prepareCrudEditValues(record: AnyRecord): AnyRecord {
  const detailPage = record.detailPage as DetailPageConfigDto | null | undefined;
  return {
    ...record,
    eventDate: record.eventDate ? dayjs(String(record.eventDate)) : undefined,
    configJson: typeof record.configJson === "string" ? JSON.parse(record.configJson) : record.configJson,
    tags: normalizeArtistFormTags(record.tags ?? record.tagsJson),
    detailPage: detailPage ? detailPageConfigDtoToFormValue(detailPage) : undefined
  };
}

export function buildCrudSaveRequest(config: CrudConfig, editing: AnyRecord | null, values: AnyRecord) {
  const body = config.normalize ? config.normalize(values) : values;
  return {
    path: editing ? `${config.path}/${editing.id}` : config.path,
    method: editing ? "PUT" as const : "POST" as const,
    body
  };
}

export function CrudPage({ config }: { config: CrudConfig }) {
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const data = await request<{ items: AnyRecord[] }>(config.path);
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

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  }

  function openEdit(record: AnyRecord) {
    setEditing(record);
    form.setFieldsValue(prepareCrudEditValues(record));
    setDrawerOpen(true);
  }

  async function save(values: AnyRecord) {
    if (saving) return;
    setSaving(true);
    try {
      const saveRequest = buildCrudSaveRequest(config, editing, values);
      await request(saveRequest.path, {
        method: saveRequest.method,
        body: JSON.stringify(saveRequest.body)
      });
      message.success("保存成功");
      setDrawerOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(record: AnyRecord) {
    Modal.confirm({
      title: "确认删除？",
      content: "删除后不可恢复",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      async onOk() {
        await request(`${config.path}/${record.id}`, { method: "DELETE" });
        message.success("删除成功");
        await load();
      }
    });
  }

  const columns: ColumnsType<AnyRecord> = [
    ...config.columns,
    {
      title: "状态",
      dataIndex: "status",
      render: (value) => <Tag color={value === "enabled" ? "green" : "default"}>{String(value)}</Tag>
    },
    {
      title: "操作",
      width: 180,
      render: (_, record) => (
        <Space>
          <Button data-testid={`${config.testid}-edit`} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button danger data-testid={`${config.testid}-delete`} onClick={() => remove(record)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Card
      title={config.title}
      extra={
        <Button data-testid={`${config.testid}-create`} type="primary" onClick={openCreate}>
          新增
        </Button>
      }
    >
      <Table
        data-testid={`${config.testid}-table`}
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
        pagination={{ pageSize: 10 }}
        onRow={(record) => ({
          "data-testid": `${config.testid}-row-${record.id}`
        } as unknown as React.HTMLAttributes<HTMLTableRowElement>)}
      />
      <Drawer
        data-testid={`${config.testid}-drawer`}
        title={editing ? `编辑${config.title}` : `新增${config.title}`}
        open={drawerOpen}
        width={config.drawerWidth ?? 560}
        onClose={() => setDrawerOpen(false)}
      >
        <Form data-testid={`${config.testid}-form`} form={form} layout="vertical" onFinish={save} initialValues={{ status: "enabled", sortOrder: 1 }}>
          {config.fields(form, editing)}
          <Button data-testid={`${config.testid}-save`} type="primary" htmlType="submit" loading={saving} disabled={saving}>
            保存
          </Button>
        </Form>
      </Drawer>
    </Card>
  );
}

const statusOptions = statusValues.map((value) => ({ value, label: value === "enabled" ? "启用" : "停用" }));

function detailTypeColumn(): ColumnsType<AnyRecord>[number] {
  return {
    title: "详情页类型",
    dataIndex: "detailPageTypeLabel",
    width: 150,
    render: (value) => typeof value === "string" && value ? value : "详情待补充"
  };
}

function detailSummaryColumn(): ColumnsType<AnyRecord>[number] {
  return {
    title: "详情摘要",
    key: "detailPageSummary",
    width: 210,
    render: (_, record) => record.detailPageType
      ? `BANNER ${Number(record.bannerCount ?? 0)} · 正文媒体 ${Number(record.detailMediaCount ?? 0)} · ${record.hasRichText ? "有富文本" : "无富文本"}`
      : "详情待补充"
  };
}

function StatusField() {
  return (
    <Form.Item label="状态" name="status" rules={[{ required: true }]}>
      <Select data-testid="status-select" options={statusOptions} />
    </Form.Item>
  );
}

function SortField() {
  return (
    <Form.Item label="排序" name="sortOrder" rules={[{ required: true }]}>
      <InputNumber data-testid="sort-order" min={0} />
    </Form.Item>
  );
}

function MenuConfigFields({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const type = Form.useWatch("type", form) as MenuType | undefined;
  if (!type) return null;
  if (["host", "singer", "actor"].includes(type)) {
    return (
      <>
        <Form.Item label="默认排序" name={["configJson", "defaultSort"]} initialValue="sortOrder">
          <Select
            data-testid="menu-config-default-sort"
            options={[
              { value: "sortOrder", label: "sortOrder" },
              { value: "newest", label: "newest" }
            ]}
          />
        </Form.Item>
        <Form.Item label="每页数量" name={["configJson", "pageSize"]} initialValue={10}>
          <InputNumber data-testid="menu-config-page-size" min={1} />
        </Form.Item>
      </>
    );
  }
  if (type === "activity_case") {
    return (
      <>
        <Form.Item label="分类" name={["configJson", "category"]}>
          <Input data-testid="menu-config-category" />
        </Form.Item>
        <Form.Item label="只看精选" name={["configJson", "onlyFeatured"]} valuePropName="checked" initialValue={false}>
          <Switch data-testid="menu-config-only-featured" />
        </Form.Item>
        <Form.Item label="每页数量" name={["configJson", "pageSize"]} initialValue={10}>
          <InputNumber min={1} />
        </Form.Item>
      </>
    );
  }
  return (
    <>
      <Form.Item label="电话" name={["configJson", "phone"]}>
        <Input data-testid="menu-config-phone" />
      </Form.Item>
      <Form.Item label="地址" name={["configJson", "address"]}>
        <Input />
      </Form.Item>
      <Form.Item label="微信号" name={["configJson", "wechat"]}>
        <Input />
      </Form.Item>
      <Form.Item label="简介" name={["configJson", "description"]}>
        <Input.TextArea />
      </Form.Item>
    </>
  );
}

function detailBusinessFields(values: AnyRecord) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !["detail", "detailMediaAssetIds", "detailPage"].includes(key))
  );
}

function normalizeArtistPayload(values: AnyRecord) {
  return {
    ...detailBusinessFields(values),
    tags: normalizeArtistFormTags(values.tags),
    detailPage: normalizeDetailPageFormValue(values.detailPage)
  };
}

function normalizeCasePayload(values: AnyRecord) {
  return {
    ...detailBusinessFields(values),
    eventDate: values.eventDate ? dayjs(values.eventDate as string).toISOString() : new Date().toISOString(),
    detailPage: normalizeDetailPageFormValue(values.detailPage)
  };
}

function CaseCrudFields({ form, editing }: { form: ReturnType<typeof Form.useForm>[0]; editing: AnyRecord | null }) {
  const title = Form.useWatch("title", form) as string | undefined;
  const coverAssetId = Form.useWatch("coverAssetId", form) as number | null | undefined;
  return (
    <>
      <Form.Item label="标题" name="title" rules={[{ required: true }]}>
        <Input data-testid="case-title" />
      </Form.Item>
      <Form.Item label="分类" name="category" rules={[{ required: true }]}>
        <Input data-testid="case-category" />
      </Form.Item>
      <Form.Item label="标签" name="tag" rules={[{ required: true }]}>
        <Input data-testid="case-tag" />
      </Form.Item>
      <Form.Item label="封面图" name="coverAssetId" rules={[{ required: true }]}>
        <MediaField testid="case-cover-select" fieldKey="case.cover" />
      </Form.Item>
      <Form.Item label="简介" name="summary" rules={[{ required: true }]}>
        <Input.TextArea data-testid="case-summary" />
      </Form.Item>
      <Form.Item label="活动日期" name="eventDate" rules={[{ required: true }]}>
        <DatePicker data-testid="case-event-date" />
      </Form.Item>
      <Form.Item label="地点" name="location" rules={[{ required: true }]}>
        <Input data-testid="case-location" />
      </Form.Item>
      <Form.Item label="是否精选" name="isFeatured" valuePropName="checked" initialValue={false}>
        <Switch data-testid="case-featured" />
      </Form.Item>
      <Form.Item label="首页排序" name="featuredSortOrder" initialValue={1}>
        <InputNumber data-testid="case-featured-sort-order" min={0} />
      </Form.Item>
      <SortField />
      <StatusField />
      <DetailPageConfigFields
        form={form}
        ownerType="activity_case"
        ownerPreviewData={{ title, coverAssetId }}
        initialDetailPage={editing ? (editing.detailPage as DetailPageConfigDto | null | undefined) ?? null : undefined}
      />
    </>
  );
}

function ArtistCrudFields({ form, editing }: { form: ReturnType<typeof Form.useForm>[0]; editing: AnyRecord | null }) {
  const title = Form.useWatch("name", form) as string | undefined;
  const avatarAssetId = Form.useWatch("avatarAssetId", form) as number | null | undefined;
  return (
    <>
      <Form.Item label="姓名/艺名" name="name" rules={[{ required: true }]}>
        <Input data-testid="artist-name" />
      </Form.Item>
      <Form.Item label="类型" name="type" rules={[{ required: true }]}>
        <Select data-testid="artist-type" options={artistTypeValues.map((value) => ({ value, label: artistTypeLabels[value] }))} />
      </Form.Item>
      <Form.Item label="列表封面图" name="avatarAssetId" rules={[{ required: true, message: "请选择列表封面图" }]} extra="推荐尺寸 690×480，前台将以 aspectFill 裁切显示">
        <MediaField testid="artist-cover-select" fieldKey="artist.avatar" />
      </Form.Item>
      <Form.Item label="演绎地点" name="location" rules={[{ required: true, message: "请输入演绎地点" }, { max: 30 }]}>
        <Input data-testid="artist-location" maxLength={30} showCount />
      </Form.Item>
      <Form.Item label="左上角标签" name="badge" rules={[{ required: true, message: "请输入左上角标签" }, { max: 12 }]}>
        <Input data-testid="artist-badge" maxLength={12} showCount />
      </Form.Item>
      <Form.Item
        label="下方多个标签"
        name="tags"
        getValueFromEvent={(value) => normalizeArtistFormTags(value).slice(0, 4)}
        rules={[
          { required: true, message: "请至少填写一个标签" },
          {
            validator: (_, value) => {
              const tags = normalizeArtistFormTags(value);
              return tags.length >= 1 && tags.length <= 4 ? Promise.resolve() : Promise.reject(new Error("请填写 1 至 4 个标签"));
            }
          }
        ]}
      >
        <Select data-testid="artist-tags" mode="tags" tokenSeparators={[",", "，"]} />
      </Form.Item>
      <Form.Item label="演职人员描述" name="summary" rules={[{ required: true, message: "请输入演职人员描述" }, { max: 120 }]}>
        <Input.TextArea data-testid="artist-summary" maxLength={120} showCount autoSize={{ minRows: 3, maxRows: 5 }} />
      </Form.Item>
      <SortField />
      <StatusField />
      <DetailPageConfigFields
        form={form}
        ownerType="artist"
        ownerPreviewData={{ title, avatarAssetId }}
        initialDetailPage={editing ? (editing.detailPage as DetailPageConfigDto | null | undefined) ?? null : undefined}
      />
    </>
  );
}

export const configs: Record<string, CrudConfig> = {
  announcements: {
    title: "公告管理",
    path: "/api/admin/announcements",
    testid: "announcements",
    columns: [
      { title: "概述", dataIndex: "summary", ellipsis: true },
      { title: "内容", dataIndex: "content", ellipsis: true },
      { title: "显示时间", dataIndex: "displayDurationMs" },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: () => (
      <>
        <Form.Item label="公告概述" name="summary" rules={[{ required: true }]}>
          <Input data-testid="announcement-summary" />
        </Form.Item>
        <Form.Item label="公告内容" name="content" rules={[{ required: true }]}>
          <Input.TextArea data-testid="announcement-content" />
        </Form.Item>
        <Form.Item label="单条显示时间" name="displayDurationMs" initialValue={3000} rules={[{ required: true }]}>
          <InputNumber data-testid="announcement-display-duration" min={1000} />
        </Form.Item>
        <SortField />
        <StatusField />
      </>
    )
  },
  banners: {
    title: "Banner 管理",
    path: "/api/admin/banners",
    testid: "banners",
    columns: [
      { title: "标题", dataIndex: "title" },
      { title: "跳转类型", dataIndex: "linkType" },
      { title: "切换时间", dataIndex: "switchDurationMs" },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: () => (
      <>
        <Form.Item label="标题" name="title" rules={[{ required: true }]}>
          <Input data-testid="banner-title" />
        </Form.Item>
        <Form.Item label="图片" name="imageAssetId" rules={[{ required: true }]}>
          <MediaField testid="banner-image-select" fieldKey="banner.image" />
        </Form.Item>
        <Form.Item label="跳转类型" name="linkType" initialValue="none">
          <Select data-testid="banner-link-type" options={bannerLinkTypeValues.map((value) => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item label="跳转目标" name="linkTarget">
          <Input />
        </Form.Item>
        <Form.Item label="切换时间" name="switchDurationMs" initialValue={3500}>
          <InputNumber data-testid="banner-switch-duration" min={1000} />
        </Form.Item>
        <SortField />
        <StatusField />
      </>
    )
  },
  "menu-items": {
    title: "菜单管理",
    path: "/api/admin/menu-items",
    testid: "menu-items",
    columns: [
      { title: "菜单文本", dataIndex: "text" },
      { title: "类型", dataIndex: "type" },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: (form) => (
      <>
        <Form.Item label="菜单文本" name="text" rules={[{ required: true }]}>
          <Input data-testid="menu-text" />
        </Form.Item>
        <Form.Item label="菜单图标" name="iconAssetId" rules={[{ required: true }]}>
          <MediaField testid="menu-icon-select" fieldKey="menu.icon" />
        </Form.Item>
        <Form.Item label="菜单类型" name="type" rules={[{ required: true }]}>
          <Select
            data-testid="menu-type-select"
            options={[
              { value: "host", label: "主持人" },
              { value: "singer", label: "歌手" },
              { value: "actor", label: "演员" },
              { value: "activity_case", label: "活动案例" },
              { value: "contact", label: "联系我们" }
            ]}
          />
        </Form.Item>
        <MenuConfigFields form={form} />
        <SortField />
        <StatusField />
      </>
    )
  },
  cases: {
    title: "案例管理",
    path: "/api/admin/cases",
    testid: "cases",
    columns: [
      { title: "标题", dataIndex: "title" },
      { title: "分类", dataIndex: "category" },
      { title: "精选", dataIndex: "isFeatured", render: (value) => (value ? "是" : "否") },
      { title: "排序", dataIndex: "sortOrder" },
      detailTypeColumn(),
      detailSummaryColumn()
    ],
    drawerWidth: 1040,
    normalize: normalizeCasePayload,
    fields: (form, editing) => <CaseCrudFields form={form} editing={editing} />
  },
  artists: {
    title: "人员管理",
    path: "/api/admin/artists",
    testid: "artists",
    columns: [
      {
        title: "封面",
        dataIndex: "avatarAsset",
        width: 94,
        render: (asset) => asset && typeof asset === "object" && "url" in asset ? <img className="artist-cover-thumb" src={String(asset.url)} alt="列表封面图" /> : "—"
      },
      { title: "姓名/艺名", dataIndex: "name" },
      { title: "人员类型", dataIndex: "type", render: (value) => artistTypeLabels[value as keyof typeof artistTypeLabels] ?? String(value) },
      { title: "演绎地点", dataIndex: "location", ellipsis: true },
      { title: "左上角标签", dataIndex: "badge", ellipsis: true },
      {
        title: "下方标签",
        dataIndex: "tags",
        render: (value, record) => normalizeArtistFormTags(value ?? record.tagsJson).map((tag) => <Tag key={tag}>{tag}</Tag>)
      },
      { title: "排序", dataIndex: "sortOrder" },
      detailTypeColumn(),
      detailSummaryColumn()
    ],
    drawerWidth: 1040,
    normalize: normalizeArtistPayload,
    fields: (form, editing) => <ArtistCrudFields form={form} editing={editing} />
  }
};

function AppRoutes() {
  const crudRoutes = useMemo(() => configs, []);
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <Protected>
            <AdminLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/site-config" element={<SiteConfigPage />} />
                {Object.entries(crudRoutes).map(([pathKey, config]) => (
                  <Route key={pathKey} path={`/${pathKey}`} element={<CrudPage config={config} />} />
                ))}
                <Route path="/media-assets" element={<MediaPage />} />
              </Routes>
            </AdminLayout>
          </Protected>
        }
      />
    </Routes>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </React.StrictMode>
  );
}
