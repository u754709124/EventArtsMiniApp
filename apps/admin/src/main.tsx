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
  Upload,
  message
} from "antd";
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
  bannerLinkTypeValues,
  mediaUsageValues,
  statusValues,
  type DashboardOverviewResponse,
  type MediaAssetDto,
  type MenuType
} from "@event-arts/shared";
import "./styles.css";

type ApiSuccess<T> = { success: true; data: T; message: "ok" };
type ApiFailure = { success: false; error: { code: string; message: string } };
type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
type AnyRecord = Record<string, unknown>;
type UploadRequestOption = {
  file: unknown;
  onSuccess?: (body: unknown, file: File) => void;
  onError?: (error: Error) => void;
};

const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3001";
const tokenKey = "eventarts.admin.token";

function getToken() {
  return localStorage.getItem(tokenKey);
}

async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const body = (await response.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error.message);
  return body.data;
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
      localStorage.setItem(tokenKey, data.token);
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
    localStorage.removeItem(tokenKey);
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

function MediaSelect({ value, onChange, usage }: { value?: number; onChange?: (value: number) => void; usage?: string[] }) {
  const [assets, setAssets] = useState<MediaAssetDto[]>([]);
  useEffect(() => {
    request<{ items: MediaAssetDto[] }>("/api/admin/media-assets").then((data) => setAssets(data.items));
  }, []);
  return (
    <Select
      data-testid="media-select"
      value={value}
      onChange={onChange}
      optionFilterProp="label"
      showSearch
      options={assets
        .filter((asset) => !usage || usage.includes(asset.usage))
        .map((asset) => ({ value: asset.id, label: `${asset.originalName} (${asset.usage})` }))}
    />
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
    await request("/api/admin/site-config", { method: "PUT", body: JSON.stringify(values) });
    message.success("保存成功");
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
            <MediaSelect usage={["banner", "default_banner"]} />
          </Form.Item>
          <Form.Item label="Banner 占位图" name="placeholderBannerAssetId">
            <MediaSelect usage={["placeholder_banner", "default_banner"]} />
          </Form.Item>
          <Form.Item label="菜单图标占位图" name="placeholderIconAssetId">
            <MediaSelect usage={["placeholder_icon", "menu_icon"]} />
          </Form.Item>
          <Form.Item label="案例封面占位图" name="placeholderCaseAssetId">
            <MediaSelect usage={["placeholder_case", "case_cover"]} />
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
  fields: (form: ReturnType<typeof Form.useForm>[0]) => React.ReactNode;
  normalize?: (values: AnyRecord) => AnyRecord;
};

function CrudPage({ config }: { config: CrudConfig }) {
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRecord | null>(null);
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
    form.setFieldsValue({
      ...record,
      eventDate: record.eventDate ? dayjs(String(record.eventDate)) : undefined,
      configJson: typeof record.configJson === "string" ? JSON.parse(record.configJson) : record.configJson
    });
    setDrawerOpen(true);
  }

  async function save(values: AnyRecord) {
    const normalized = config.normalize ? config.normalize(values) : values;
    await request(editing ? `${config.path}/${editing.id}` : config.path, {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(normalized)
    });
    message.success("保存成功");
    setDrawerOpen(false);
    await load();
  }

  async function remove(record: AnyRecord) {
    Modal.confirm({
      title: "确认删除？",
      content: "删除后不可恢复",
      okText: "删除",
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
      />
      <Drawer
        title={editing ? `编辑${config.title}` : `新增${config.title}`}
        open={drawerOpen}
        width={560}
        onClose={() => setDrawerOpen(false)}
      >
        <Form form={form} layout="vertical" onFinish={save} initialValues={{ status: "enabled", sortOrder: 1 }}>
          {config.fields(form)}
          <Button data-testid={`${config.testid}-save`} type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Drawer>
    </Card>
  );
}

const statusOptions = statusValues.map((value) => ({ value, label: value === "enabled" ? "启用" : "停用" }));

function StatusField() {
  return (
    <Form.Item label="状态" name="status" rules={[{ required: true }]}>
      <Select options={statusOptions} />
    </Form.Item>
  );
}

function SortField() {
  return (
    <Form.Item label="排序" name="sortOrder" rules={[{ required: true }]}>
      <InputNumber min={0} />
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

const configs: Record<string, CrudConfig> = {
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
          <InputNumber min={1000} />
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
          <MediaSelect usage={["banner", "default_banner"]} />
        </Form.Item>
        <Form.Item label="跳转类型" name="linkType" initialValue="none">
          <Select options={bannerLinkTypeValues.map((value) => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item label="跳转目标" name="linkTarget">
          <Input />
        </Form.Item>
        <Form.Item label="切换时间" name="switchDurationMs" initialValue={3500}>
          <InputNumber min={1000} />
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
          <MediaSelect usage={["menu_icon"]} />
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
      { title: "排序", dataIndex: "sortOrder" }
    ],
    normalize: (values) => ({ ...values, eventDate: values.eventDate ? dayjs(values.eventDate as string).toISOString() : new Date().toISOString() }),
    fields: () => (
      <>
        <Form.Item label="标题" name="title" rules={[{ required: true }]}>
          <Input data-testid="case-title" />
        </Form.Item>
        <Form.Item label="分类" name="category" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="标签" name="tag" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="封面图" name="coverAssetId" rules={[{ required: true }]}>
          <MediaSelect usage={["case_cover"]} />
        </Form.Item>
        <Form.Item label="简介" name="summary" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <Form.Item label="活动日期" name="eventDate" rules={[{ required: true }]}>
          <DatePicker />
        </Form.Item>
        <Form.Item label="地点" name="location" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="详情内容" name="detail" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <Form.Item label="是否精选" name="isFeatured" valuePropName="checked" initialValue={false}>
          <Switch data-testid="case-featured" />
        </Form.Item>
        <Form.Item label="首页排序" name="featuredSortOrder" initialValue={1}>
          <InputNumber min={0} />
        </Form.Item>
        <SortField />
        <StatusField />
      </>
    )
  },
  artists: {
    title: "人员管理",
    path: "/api/admin/artists",
    testid: "artists",
    columns: [
      { title: "姓名/艺名", dataIndex: "name" },
      { title: "类型", dataIndex: "type" },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: () => (
      <>
        <Form.Item label="姓名/艺名" name="name" rules={[{ required: true }]}>
          <Input data-testid="artist-name" />
        </Form.Item>
        <Form.Item label="类型" name="type" rules={[{ required: true }]}>
          <Select options={artistTypeValues.map((value) => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item label="头像" name="avatarAssetId">
          <MediaSelect usage={["person_avatar", "other"]} />
        </Form.Item>
        <Form.Item label="简介" name="summary" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <Form.Item label="标签" name="tagsJson">
          <Select mode="tags" />
        </Form.Item>
        <Form.Item label="详情内容" name="detail" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <SortField />
        <StatusField />
      </>
    )
  }
};

function MediaPage() {
  const [assets, setAssets] = useState<MediaAssetDto[]>([]);
  const [usage, setUsage] = useState<string>("banner");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await request<{ items: MediaAssetDto[] }>("/api/admin/media-assets");
      setAssets(data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function uploadFile(options: UploadRequestOption) {
    const file = options.file as File;
    const form = new FormData();
    form.append("usage", usage);
    form.append("file", file);
    try {
      await request("/api/admin/media-assets/upload", { method: "POST", body: form });
      message.success("上传成功");
      await load();
      options.onSuccess?.({}, file);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传失败");
      options.onError?.(error as Error);
    }
  }

  async function remove(asset: MediaAssetDto) {
    Modal.confirm({
      title: "确认删除资源？",
      async onOk() {
        try {
          await request(`/api/admin/media-assets/${asset.id}`, { method: "DELETE" });
          message.success("删除成功");
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "删除失败");
        }
      }
    });
  }

  return (
    <Card title="资源管理">
      <Space className="toolbar">
        <Select
          data-testid="media-usage-select"
          value={usage}
          onChange={setUsage}
          options={mediaUsageValues.map((value) => ({ value, label: value }))}
        />
        <Upload customRequest={uploadFile} showUploadList={false}>
          <Button data-testid="media-upload-button">上传资源</Button>
        </Upload>
      </Space>
      <Table
        data-testid="media-table"
        rowKey="id"
        loading={loading}
        dataSource={assets}
        columns={[
          { title: "预览", render: (_, asset) => (asset.mediaType === "image" ? <img alt={asset.originalName} src={asset.url} className="media-thumb" /> : <a href={asset.url}>视频</a>) },
          { title: "文件名", dataIndex: "originalName" },
          { title: "用途", dataIndex: "usage" },
          { title: "类型", dataIndex: "mediaType" },
          { title: "宽高", render: (_, asset) => `${asset.width ?? "-"} x ${asset.height ?? "-"}` },
          { title: "大小", dataIndex: "size" },
          { title: "上传时间", dataIndex: "createdAt" },
          { title: "操作", render: (_, asset) => <Button danger data-testid="media-delete" onClick={() => remove(asset)}>删除</Button> }
        ]}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="暂无资源" /> }}
      />
    </Card>
  );
}

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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AntApp>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AntApp>
  </React.StrictMode>
);
