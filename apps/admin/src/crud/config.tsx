import dayjs from "dayjs";
import type React from "react";
import { DatePicker, Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  artistTypeLabels,
  artistTypeValues,
  type MenuType
} from "@event-arts/shared";
import { MediaField } from "../media/MediaField";
import { DetailPageReferenceField } from "../detail-pages/DetailPageReferenceField";
import { DurationSecondsField, SortField, StatusSwitchField } from "../forms/common-fields";
import { normalizeArtistFormTags, omitBusinessDetailFields, type AnyRecord } from "../forms/form-utils";

export type CrudConfig = {
  title: string;
  navTitle?: string;
  path: string;
  routePath: string;
  testid: string;
  searchPlaceholder: string;
  searchFields: string[];
  columns: ColumnsType<AnyRecord>;
  fields: (form: ReturnType<typeof Form.useForm>[0], editing: AnyRecord | null) => React.ReactNode;
  sections?: Array<{
    title: string;
    description?: React.ReactNode;
    fields: (form: ReturnType<typeof Form.useForm>[0], editing: AnyRecord | null) => React.ReactNode;
  }>;
  normalize?: (values: AnyRecord) => AnyRecord;
  drawerWidth?: number;
  formMode: "drawer" | "page";
};

export function prepareCrudEditValues(record: AnyRecord): AnyRecord {
  return {
    ...record,
    eventDate: record.eventDate ? dayjs(String(record.eventDate)) : undefined,
    configJson: typeof record.configJson === "string" ? JSON.parse(record.configJson) : record.configJson,
    tags: normalizeArtistFormTags(record.tags ?? record.tagsJson),
    status: record.status ?? "enabled",
    detailPageId: record.detailPageId ?? null
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
    width: 220,
    render: (_, record) => record.detailPageType
      ? `BANNER ${Number(record.bannerCount ?? 0)} · 正文媒体 ${Number(record.detailMediaCount ?? 0)} · ${record.hasRichText ? "有富文本" : "无富文本"}`
      : "详情待补充"
  };
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
              { value: "sortOrder", label: "按排序值" },
              { value: "newest", label: "最新优先" }
            ]}
          />
        </Form.Item>
        <Form.Item label="每页数量" name={["configJson", "pageSize"]} initialValue={10}>
          <InputNumber data-testid="menu-config-page-size" min={1} precision={0} />
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
          <InputNumber min={1} precision={0} />
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

function normalizeArtistPayload(values: AnyRecord) {
  return {
    ...omitBusinessDetailFields(values),
    tags: normalizeArtistFormTags(values.tags),
    detailPageId: values.detailPageId ?? null
  };
}

function normalizeCasePayload(values: AnyRecord) {
  return {
    ...omitBusinessDetailFields(values),
    eventDate: values.eventDate ? dayjs(values.eventDate as string).toISOString() : new Date().toISOString(),
    detailPageId: values.detailPageId ?? null
  };
}

function CaseBasicFields() {
  return (
    <>
      <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
        <Input data-testid="case-title" />
      </Form.Item>
      <Form.Item label="分类" name="category" rules={[{ required: true, message: "请输入分类" }]}>
        <Input data-testid="case-category" />
      </Form.Item>
      <Form.Item label="标签" name="tag" rules={[{ required: true, message: "请输入标签" }]}>
        <Input data-testid="case-tag" />
      </Form.Item>
      <Form.Item label="活动日期" name="eventDate" rules={[{ required: true, message: "请选择活动日期" }]}>
        <DatePicker data-testid="case-event-date" />
      </Form.Item>
      <Form.Item label="地点" name="location" rules={[{ required: true, message: "请输入地点" }]}>
        <Input data-testid="case-location" />
      </Form.Item>
    </>
  );
}

function CaseListFields() {
  return (
    <>
      <Form.Item label="封面图" name="coverAssetId" rules={[{ required: true, message: "请选择封面图" }]}>
        <MediaField testid="case-cover-select" fieldKey="case.cover" />
      </Form.Item>
      <Form.Item className="form-grid-full" label="简介" name="summary" rules={[{ required: true, message: "请输入简介" }]}>
        <Input.TextArea data-testid="case-summary" />
      </Form.Item>
      <Form.Item label="是否精选" name="isFeatured" valuePropName="checked">
        <Switch data-testid="case-featured" />
      </Form.Item>
    </>
  );
}

function CaseDetailFields() {
  return (
    <Form.Item className="form-grid-full" label="详情页" name="detailPageId">
      <DetailPageReferenceField />
    </Form.Item>
  );
}

function CasePublishFields() {
  return (
    <>
      <Form.Item label="首页排序" name="featuredSortOrder" extra="精选案例在首页中的排序，数字越小越靠前。">
        <InputNumber data-testid="case-featured-sort-order" min={0} precision={0} />
      </Form.Item>
      <SortField />
      <StatusSwitchField />
    </>
  );
}

function CaseCrudFields() {
  return (
    <>
      <CaseBasicFields />
      <CaseListFields />
      <CaseDetailFields />
      <CasePublishFields />
    </>
  );
}

function ArtistBasicFields() {
  return (
    <>
      <Form.Item label="姓名/艺名" name="name" rules={[{ required: true, message: "请输入姓名/艺名" }]}>
        <Input data-testid="artist-name" />
      </Form.Item>
      <Form.Item label="类型" name="type" rules={[{ required: true, message: "请选择类型" }]}>
        <Select data-testid="artist-type" options={artistTypeValues.map((value) => ({ value, label: artistTypeLabels[value] }))} />
      </Form.Item>
      <Form.Item label="演绎地点" name="location" rules={[{ required: true, message: "请输入演绎地点" }, { max: 30 }]}>
        <Input data-testid="artist-location" maxLength={30} showCount />
      </Form.Item>
    </>
  );
}

function ArtistListFields() {
  return (
    <>
      <Form.Item className="form-grid-full" label="列表封面图" name="avatarAssetId" rules={[{ required: true, message: "请选择列表封面图" }]} extra="推荐尺寸 690×480，前台将以 aspectFill 裁切显示">
        <MediaField testid="artist-cover-select" fieldKey="artist.avatar" />
      </Form.Item>
      <Form.Item label="左上角标签" name="badge" rules={[{ required: true, message: "请输入左上角标签" }, { max: 12 }]}>
        <Input data-testid="artist-badge" maxLength={12} showCount />
      </Form.Item>
      <Form.Item
        className="form-grid-full"
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
      <Form.Item className="form-grid-full" label="演职人员描述" name="summary" rules={[{ required: true, message: "请输入演职人员描述" }, { max: 120 }]}>
        <Input.TextArea data-testid="artist-summary" maxLength={120} showCount autoSize={{ minRows: 3, maxRows: 5 }} />
      </Form.Item>
    </>
  );
}

function ArtistDetailFields() {
  return (
    <Form.Item className="form-grid-full" label="详情页" name="detailPageId">
      <DetailPageReferenceField />
    </Form.Item>
  );
}

function ArtistPublishFields() {
  return (
    <>
      <SortField />
      <StatusSwitchField />
    </>
  );
}

function ArtistCrudFields() {
  return (
    <>
      <ArtistBasicFields />
      <ArtistListFields />
      <ArtistDetailFields />
      <ArtistPublishFields />
    </>
  );
}

export const configs: Record<string, CrudConfig> = {
  announcements: {
    title: "公告管理",
    path: "/api/admin/announcements",
    routePath: "/announcements",
    testid: "announcements",
    searchPlaceholder: "搜索概述或内容",
    searchFields: ["summary", "content"],
    formMode: "drawer",
    columns: [
      { title: "概述", dataIndex: "summary", ellipsis: true },
      { title: "内容", dataIndex: "content", ellipsis: true },
      { title: "显示时间", dataIndex: "displayDurationMs", render: (value) => `${Number(value) / 1000} 秒` },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: () => (
      <>
        <Form.Item label="公告概述" name="summary" rules={[{ required: true, message: "请输入公告概述" }]}>
          <Input data-testid="announcement-summary" />
        </Form.Item>
        <Form.Item label="公告内容" name="content" rules={[{ required: true, message: "请输入公告内容" }]}>
          <Input.TextArea data-testid="announcement-content" />
        </Form.Item>
        <DurationSecondsField label="单条显示时间" name="displayDurationMs" testid="announcement-display-duration" initialSeconds={3} />
        <Form.Item label="详情页" name="detailPageId">
          <DetailPageReferenceField />
        </Form.Item>
        <SortField />
        <StatusSwitchField />
      </>
    )
  },
  banners: {
    title: "首页轮播",
    navTitle: "首页轮播",
    path: "/api/admin/banners",
    routePath: "/banners",
    testid: "banners",
    searchPlaceholder: "搜索标题",
    searchFields: ["title"],
    formMode: "drawer",
    columns: [
      { title: "标题", dataIndex: "title" },
      { title: "详情页", dataIndex: "detailPageId", render: (value) => value ? `#${value}` : "未绑定" },
      { title: "切换时间", dataIndex: "switchDurationMs", render: (value) => `${Number(value) / 1000} 秒` },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: () => (
      <>
        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
          <Input data-testid="banner-title" />
        </Form.Item>
        <Form.Item label="图片" name="imageAssetId" rules={[{ required: true, message: "请选择图片" }]}>
          <MediaField testid="banner-image-select" fieldKey="banner.image" />
        </Form.Item>
        <Form.Item label="详情页" name="detailPageId">
          <DetailPageReferenceField />
        </Form.Item>
        <DurationSecondsField label="切换时间" name="switchDurationMs" testid="banner-switch-duration" initialSeconds={3.5} />
        <SortField />
        <StatusSwitchField />
      </>
    )
  },
  "menu-items": {
    title: "首页菜单",
    path: "/api/admin/menu-items",
    routePath: "/menu-items",
    testid: "menu-items",
    searchPlaceholder: "搜索菜单文本或类型",
    searchFields: ["text", "type"],
    formMode: "drawer",
    columns: [
      { title: "菜单文本", dataIndex: "text" },
      { title: "类型", dataIndex: "type" },
      { title: "排序", dataIndex: "sortOrder" }
    ],
    fields: (form) => (
      <>
        <Form.Item label="菜单文本" name="text" rules={[{ required: true, message: "请输入菜单文本" }]}>
          <Input data-testid="menu-text" />
        </Form.Item>
        <Form.Item label="菜单图标" name="iconAssetId" rules={[{ required: true, message: "请选择菜单图标" }]}>
          <MediaField testid="menu-icon-select" fieldKey="menu.icon" />
        </Form.Item>
        <Form.Item label="菜单类型" name="type" rules={[{ required: true, message: "请选择菜单类型" }]}>
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
        <StatusSwitchField />
      </>
    )
  },
  cases: {
    title: "案例管理",
    path: "/api/admin/cases",
    routePath: "/cases",
    testid: "cases",
    searchPlaceholder: "搜索标题、分类、标签、地点",
    searchFields: ["title", "category", "tag", "location"],
    formMode: "page",
    columns: [
      { title: "标题", dataIndex: "title" },
      { title: "分类", dataIndex: "category" },
      { title: "精选", dataIndex: "isFeatured", render: (value) => (value ? <Tag color="gold">是</Tag> : "否") },
      { title: "排序", dataIndex: "sortOrder" },
      detailTypeColumn(),
      detailSummaryColumn()
    ],
    normalize: normalizeCasePayload,
    fields: () => <CaseCrudFields />,
    sections: [
      { title: "基础信息", fields: () => <CaseBasicFields /> },
      { title: "列表展示", description: "封面和简介会用于前台案例列表；精选开关决定是否进入首页精选区域。", fields: () => <CaseListFields /> },
      { title: "详情内容", description: "当前版本使用独立详情页引用，详情页可在内容管理中统一维护。", fields: () => <CaseDetailFields /> },
      { title: "发布设置", fields: () => <CasePublishFields /> }
    ]
  },
  artists: {
    title: "人员管理",
    path: "/api/admin/artists",
    routePath: "/artists",
    testid: "artists",
    searchPlaceholder: "搜索姓名、类型、地点、标签",
    searchFields: ["name", "type", "location", "badge", "tags"],
    formMode: "page",
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
    normalize: normalizeArtistPayload,
    fields: () => <ArtistCrudFields />,
    sections: [
      { title: "基础信息", fields: () => <ArtistBasicFields /> },
      { title: "列表展示", description: "下方标签最多 4 个；列表描述会在前台列表中显示两行。", fields: () => <ArtistListFields /> },
      { title: "详情内容", description: "当前版本使用独立详情页引用，不再内嵌完整详情配置。", fields: () => <ArtistDetailFields /> },
      { title: "发布设置", fields: () => <ArtistPublishFields /> }
    ]
  }
};
