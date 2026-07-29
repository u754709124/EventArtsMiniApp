import dayjs from "dayjs";
import type React from "react";
import { useEffect, useState } from "react";
import { AutoComplete, DatePicker, Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  detailPageTypeDefinitions,
  detailPageTypeValues,
  normalizeArticleCategory,
  normalizeArtistCategory,
  normalizeLegacyArtistCategory,
  menuConfigSchemaByType,
  type DetailPageType,
  type MenuType
} from "@event-arts/shared";
import { MediaField } from "../media/MediaField";
import { DetailPageReferenceField } from "../detail-pages/DetailPageReferenceField";
import { DurationSecondsField, SortField, StatusSwitchField } from "../forms/common-fields";
import { normalizeArtistFormTags, omitBusinessDetailFields, type AnyRecord } from "../forms/form-utils";
import { request } from "../api";
import type { CrudDefaultValues } from "./create-defaults";

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
  toolbarFilters?: (
    filters: Record<string, string>,
    setFilter: (next: Record<string, string | undefined>) => void
  ) => React.ReactNode;
  sections?: Array<{
    title: string;
    description?: React.ReactNode;
    fields: (form: ReturnType<typeof Form.useForm>[0], editing: AnyRecord | null) => React.ReactNode;
  }>;
  normalize?: (values: AnyRecord) => AnyRecord;
  defaultValues?: CrudDefaultValues;
  sortFields?: string[];
  drawerWidth?: number;
  formMode: "drawer" | "page";
  sortable?: boolean;
};

export function prepareCrudEditValues(record: AnyRecord): AnyRecord {
  const configJson = typeof record.configJson === "string" ? JSON.parse(record.configJson) : record.configJson;
  const preparedConfigJson = record.type === "article" && (!configJson || typeof configJson !== "object" || !("category" in configJson))
    ? { ...(configJson && typeof configJson === "object" ? configJson : {}), category: allArticlesCategoryValue }
    : configJson;
  const isArtistRecord = "avatarAssetId" in record || "avatarAsset" in record;
  const preparedType = isArtistRecord && typeof record.type === "string" ? normalizeLegacyArtistCategory(record.type) : record.type;
  return {
    ...record,
    type: preparedType,
    eventDate: record.eventDate ? dayjs(String(record.eventDate)) : undefined,
    publishedAt: record.publishedAt ? dayjs(String(record.publishedAt)) : undefined,
    configJson: preparedConfigJson,
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

type CaseCategoryListResponse = {
  items: string[];
};

type ArticleCategoryListResponse = {
  categories: string[];
};

type ArtistCategoryListResponse = {
  items: string[];
};

function useCaseCategoryOptions() {
  const [options, setOptions] = useState<Array<{ value: string }>>([]);
  useEffect(() => {
    let active = true;
    void request<CaseCategoryListResponse>("/api/admin/case-categories")
      .then((data) => {
        if (!active) return;
        const categories = [...new Set(data.items
          .map((item) => item.trim())
          .filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, "zh-CN"));
        setOptions(categories.map((value) => ({ value })));
      })
      .catch(() => {
        if (active) setOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);
  return options;
}

function useArticleCategoryOptions() {
  const [options, setOptions] = useState<Array<{ value: string; label?: string }>>([]);
  useEffect(() => {
    let active = true;
    void request<ArticleCategoryListResponse>("/api/admin/articles/categories")
      .then((data) => {
        if (!active) return;
        const categories = [...new Set(data.categories
          .map((item) => normalizeArticleCategory(item))
          .filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, "zh-CN"));
        setOptions(categories.map((value) => ({ value, label: value })));
      })
      .catch(() => {
        if (active) setOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);
  return options;
}

function useArtistCategoryOptions() {
  const [options, setOptions] = useState<Array<{ value: string }>>([]);
  useEffect(() => {
    let active = true;
    void request<ArtistCategoryListResponse>("/api/admin/artist-categories")
      .then((data) => {
        if (!active) return;
        const categories = [...new Set(data.items
          .map((item) => normalizeArtistCategory(item))
          .filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, "zh-CN"));
        setOptions(categories.map((value) => ({ value })));
      })
      .catch(() => {
        if (active) setOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);
  return options;
}

type StringFieldProps = {
  testid: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
};

function MenuCaseCategorySelect({ testid, value, onChange }: StringFieldProps) {
  const options = useCaseCategoryOptions();
  return (
    <Select
      allowClear
      showSearch
      data-testid={testid}
      value={value}
      onChange={onChange}
      options={options}
      optionFilterProp="value"
      placeholder="选择已有案例分类"
    />
  );
}

function CaseCategoryAutoComplete({ testid, value, onChange }: StringFieldProps) {
  const options = useCaseCategoryOptions();
  return (
    <AutoComplete
      allowClear
      value={value}
      onChange={onChange}
      options={options}
      filterOption={(inputValue, option) =>
        String(option?.value ?? "").toLocaleLowerCase("zh-CN").includes(inputValue.trim().toLocaleLowerCase("zh-CN"))
      }
    >
      <Input data-testid={testid} />
    </AutoComplete>
  );
}

function ArtistCategoryAutoComplete({ testid, value, onChange }: StringFieldProps) {
  const options = useArtistCategoryOptions();
  return (
    <AutoComplete
      allowClear
      value={value}
      onChange={onChange}
      options={options}
      filterOption={(inputValue, option) =>
        String(option?.value ?? "").toLocaleLowerCase("zh-CN").includes(inputValue.trim().toLocaleLowerCase("zh-CN"))
      }
    >
      <Input data-testid={testid} maxLength={30} showCount />
    </AutoComplete>
  );
}

function ArticleCategoryAutoComplete({ testid, value, onChange }: StringFieldProps) {
  const options = useArticleCategoryOptions();
  return (
    <AutoComplete
      allowClear
      value={value}
      onChange={onChange}
      options={options}
      filterOption={(inputValue, option) =>
        String(option?.value ?? "").toLocaleLowerCase("zh-CN").includes(inputValue.trim().toLocaleLowerCase("zh-CN"))
      }
    >
      <Input data-testid={testid} maxLength={30} showCount />
    </AutoComplete>
  );
}

const allArticlesCategoryValue = "__ALL_ARTICLES__";

function MenuArticleCategorySelect({ testid, value, onChange }: StringFieldProps) {
  const options = useArticleCategoryOptions();
  const hasCurrentValue = Boolean(value && value !== allArticlesCategoryValue && !options.some((option) => option.value === value));
  return (
    <Select
      data-testid={testid}
      showSearch
      value={value}
      onChange={onChange}
      options={[
        { value: allArticlesCategoryValue, label: "全部文章" },
        ...(hasCurrentValue ? [{ value: value as string, label: `${value}（当前分类已无可用文章）` }] : []),
        ...options
      ]}
      optionFilterProp="label"
      placeholder="选择已有文章分类"
    />
  );
}

function ArticleCategoryFilter({
  value,
  onChange
}: {
  value?: string;
  onChange: (value?: string) => void;
}) {
  const options = useArticleCategoryOptions();
  return (
    <Select
      data-testid="articles-category-filter"
      allowClear
      showSearch
      placeholder="全部分类"
      value={value || undefined}
      onChange={(next) => onChange(next)}
      options={options}
      optionFilterProp="label"
      style={{ width: 180 }}
    />
  );
}

export function MenuConfigFields({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const type = Form.useWatch("type", form) as MenuType | undefined;
  const detailPageType = Form.useWatch(["configJson", "detailPageType"], form) as DetailPageType | undefined;
  if (!type) return null;
  if (type === "artist") {
    return (
      <>
        <Form.Item label="人员分类" name={["configJson", "category"]}>
          <ArtistCategoryAutoComplete testid="menu-config-artist-category" />
        </Form.Item>
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
          <MenuCaseCategorySelect testid="menu-config-category" />
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
  if (type === "article") {
    return (
      <>
        <Form.Item label="分类" name={["configJson", "category"]} initialValue={allArticlesCategoryValue}>
          <MenuArticleCategorySelect testid="menu-config-article-category" />
        </Form.Item>
        <Form.Item label="每页数量" name={["configJson", "pageSize"]} initialValue={10}>
          <InputNumber data-testid="menu-config-article-page-size" min={1} max={50} precision={0} />
        </Form.Item>
      </>
    );
  }
  if (type === "detail_page") {
    return (
      <>
        <Form.Item
          label="详情页类型"
          name={["configJson", "detailPageType"]}
          rules={[{ required: true, message: "请选择详情页类型" }]}
        >
          <Select
            aria-label="菜单详情页类型"
            data-testid="menu-config-detail-page-type"
            placeholder="请先选择详情页类型"
            options={detailPageTypeValues.map((value) => ({
              value,
              label: detailPageTypeDefinitions[value].label
            }))}
            onChange={(nextType) => {
              if (nextType !== detailPageType) form.setFieldValue(["configJson", "detailPageId"], null);
            }}
          />
        </Form.Item>
        <Form.Item
          label="对应详情页"
          name={["configJson", "detailPageId"]}
          rules={[{ required: true, message: "请选择对应详情页" }]}
        >
          <DetailPageReferenceField detailPageType={detailPageType} disabled={!detailPageType} />
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
    type: normalizeLegacyArtistCategory(String(values.type ?? "")),
    tags: normalizeArtistFormTags(values.tags),
    summary: typeof values.summary === "string" ? values.summary.trim() : "",
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

function normalizeArticlePayload(values: AnyRecord) {
  return {
    ...omitBusinessDetailFields(values),
    category: normalizeArticleCategory(String(values.category ?? "")),
    publishedAt: values.publishedAt ? dayjs(values.publishedAt as string).toISOString() : new Date().toISOString(),
    detailPageId: values.detailPageId ?? null
  };
}

function isMenuType(value: unknown): value is MenuType {
  return typeof value === "string" && value in menuConfigSchemaByType;
}

function normalizeMenuPayload(values: AnyRecord) {
  const body: AnyRecord = {};
  for (const key of ["text", "iconAssetId", "type", "showOnHome", "sortOrder", "status"] as const) {
    if (Object.hasOwn(values, key)) body[key] = values[key];
  }
  if (Object.hasOwn(values, "configJson") || isMenuType(values.type)) {
    const rawConfig: AnyRecord = values.configJson && typeof values.configJson === "object" ? { ...values.configJson } : {};
    if (rawConfig.category === allArticlesCategoryValue) delete rawConfig.category;
    body.configJson = isMenuType(values.type)
      ? menuConfigSchemaByType[values.type].parse(rawConfig)
      : rawConfig;
  }
  return body;
}

function CaseBasicFields() {
  return (
    <>
      <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
        <Input data-testid="case-title" />
      </Form.Item>
      <Form.Item label="分类" name="category" rules={[{ required: true, message: "请输入分类" }]}>
        <CaseCategoryAutoComplete testid="case-category" />
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

function ArticleBasicFields() {
  return (
    <>
      <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }, { max: 100 }]}>
        <Input data-testid="article-title" maxLength={100} showCount />
      </Form.Item>
      <Form.Item label="分类" name="category" rules={[{ required: true, message: "请输入分类" }, { max: 30 }]}>
        <ArticleCategoryAutoComplete testid="article-category" />
      </Form.Item>
      <Form.Item label="发布时间" name="publishedAt" rules={[{ required: true, message: "请选择发布时间" }]}>
        <DatePicker data-testid="article-published-at" showTime />
      </Form.Item>
    </>
  );
}

function ArticleListFields() {
  return (
    <>
      <Form.Item className="form-grid-full" label="封面图" name="coverAssetId" rules={[{ required: true, message: "请选择封面图" }]}>
        <MediaField testid="article-cover-select" fieldKey="article.cover" />
      </Form.Item>
      <Form.Item className="form-grid-full" label="摘要" name="summary" rules={[{ required: true, message: "请输入摘要" }, { max: 240 }]}>
        <Input.TextArea data-testid="article-summary" maxLength={240} showCount autoSize={{ minRows: 3, maxRows: 5 }} />
      </Form.Item>
      <Form.Item label="是否精选" name="isFeatured" valuePropName="checked">
        <Switch data-testid="article-featured" />
      </Form.Item>
    </>
  );
}

function ArticleDetailFields() {
  return (
    <Form.Item className="form-grid-full" label="详情页" name="detailPageId">
      <DetailPageReferenceField />
    </Form.Item>
  );
}

function ArticlePublishFields() {
  return (
    <>
      <Form.Item label="精选排序" name="featuredSortOrder" extra="精选文章在首页中的排序，数字越小越靠前。">
        <InputNumber data-testid="article-featured-sort-order" min={0} precision={0} />
      </Form.Item>
      <Form.Item label="普通排序" name="sortOrder" rules={[{ required: true }]} extra="数字越小越靠前；相同数字按创建顺序展示。">
        <InputNumber data-testid="article-sort-order" min={0} precision={0} />
      </Form.Item>
      <StatusSwitchField />
    </>
  );
}

function ArticleCrudFields() {
  return (
    <>
      <ArticleBasicFields />
      <ArticleListFields />
      <ArticleDetailFields />
      <ArticlePublishFields />
    </>
  );
}

function ArtistBasicFields() {
  return (
    <>
      <Form.Item label="姓名/艺名" name="name" rules={[{ required: true, message: "请输入姓名/艺名" }]}>
        <Input data-testid="artist-name" />
      </Form.Item>
      <Form.Item label="分类" name="type" rules={[{ required: true, message: "请输入分类" }, { max: 30 }]}>
        <ArtistCategoryAutoComplete testid="artist-type" />
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
        label="下方标签（选填）"
        name="tags"
        extra="最多 4 个；不填写时前台不展示标签区域。"
        getValueFromEvent={(value) => normalizeArtistFormTags(value).slice(0, 4)}
        rules={[
          {
            validator: (_, value) => {
              const tags = normalizeArtistFormTags(value);
              if (tags.length > 4) return Promise.reject(new Error("最多填写 4 个标签"));
              if (tags.some((item) => item.length > 12)) return Promise.reject(new Error("单个标签不能超过 12 个字符"));
              return Promise.resolve();
            }
          }
        ]}
      >
        <Select data-testid="artist-tags" mode="tags" tokenSeparators={[",", "，"]} />
      </Form.Item>
      <Form.Item
        className="form-grid-full"
        label="演职人员描述（选填）"
        name="summary"
        extra="不填写时前台不展示描述。"
        rules={[{ max: 120 }]}
      >
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
    sortable: true,
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
    sortable: true,
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
    title: "分类菜单",
    path: "/api/admin/menu-items",
    routePath: "/menu-items",
    testid: "menu-items",
    searchPlaceholder: "搜索菜单文本或类型",
    searchFields: ["text", "type"],
    formMode: "drawer",
    sortable: true,
    defaultValues: { showOnHome: true },
    normalize: normalizeMenuPayload,
    columns: [
      { title: "菜单文本", dataIndex: "text" },
      { title: "类型", dataIndex: "type" },
      { title: "首页显示", dataIndex: "showOnHome", render: (value) => (value ? <Tag color="green">显示</Tag> : <Tag>隐藏</Tag>) },
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
              { value: "artist", label: "人员" },
              { value: "activity_case", label: "活动案例" },
              { value: "article", label: "文章" },
              { value: "detail_page", label: "详情页直达" },
              { value: "contact", label: "联系我们" }
            ]}
            onChange={() => form.setFieldValue("configJson", undefined)}
          />
        </Form.Item>
        <MenuConfigFields form={form} />
        <Form.Item
          label="是否显示在首页"
          name="showOnHome"
          valuePropName="checked"
          initialValue
          extra="关闭后仅从首页隐藏，分类页仍会展示；状态停用后前台均不展示。"
        >
          <Switch data-testid="menu-show-on-home" checkedChildren="显示" unCheckedChildren="隐藏" />
        </Form.Item>
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
    sortable: true,
    sortFields: ["sortOrder", "featuredSortOrder"],
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
  articles: {
    title: "文章管理",
    path: "/api/admin/articles",
    routePath: "/articles",
    testid: "articles",
    searchPlaceholder: "搜索标题、分类、摘要",
    searchFields: ["title", "category", "summary"],
    formMode: "page",
    sortable: true,
    defaultValues: () => ({ publishedAt: dayjs() }),
    sortFields: ["sortOrder", "featuredSortOrder"],
    toolbarFilters: (filters, setFilter) => (
      <>
        <ArticleCategoryFilter
          value={filters.category}
          onChange={(value) => setFilter({ category: value, page: undefined })}
        />
        <Select
          data-testid="articles-featured-filter"
          allowClear
          placeholder="全部精选"
          value={filters.isFeatured || undefined}
          onChange={(value) => setFilter({ isFeatured: value, page: undefined })}
          options={[
            { value: "true", label: "精选" },
            { value: "false", label: "非精选" }
          ]}
          style={{ width: 160 }}
        />
      </>
    ),
    columns: [
      {
        title: "封面",
        dataIndex: "coverAsset",
        width: 94,
        render: (asset) => asset && typeof asset === "object" && "url" in asset ? <img className="artist-cover-thumb" src={String(asset.url)} alt="文章封面" /> : "—"
      },
      { title: "标题", dataIndex: "title", ellipsis: true },
      { title: "分类", dataIndex: "category" },
      { title: "发布时间", dataIndex: "publishedAt", render: (value) => value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm") : "—" },
      { title: "精选", dataIndex: "isFeatured", render: (value) => (value ? <Tag color="gold">是</Tag> : "否") },
      { title: "精选排序", dataIndex: "featuredSortOrder" },
      { title: "普通排序", dataIndex: "sortOrder" },
      { title: "详情页", dataIndex: "detailPageId", render: (value) => value ? `#${value}` : "未绑定" }
    ],
    normalize: normalizeArticlePayload,
    fields: () => <ArticleCrudFields />,
    sections: [
      { title: "基础信息", fields: () => <ArticleBasicFields /> },
      { title: "列表展示", description: "封面、摘要和发布时间会用于前台文章卡片。", fields: () => <ArticleListFields /> },
      { title: "详情内容", description: "文章详情复用独立详情页，不在文章中维护专属正文。", fields: () => <ArticleDetailFields /> },
      { title: "发布设置", fields: () => <ArticlePublishFields /> }
    ]
  },
  artists: {
    title: "人员管理",
    path: "/api/admin/artists",
    routePath: "/artists",
    testid: "artists",
    searchPlaceholder: "搜索姓名、分类、地点、标签",
    searchFields: ["name", "type", "location", "badge", "tags"],
    formMode: "page",
    sortable: true,
    columns: [
      {
        title: "封面",
        dataIndex: "avatarAsset",
        width: 94,
        render: (asset) => asset && typeof asset === "object" && "url" in asset ? <img className="artist-cover-thumb" src={String(asset.url)} alt="列表封面图" /> : "—"
      },
      { title: "姓名/艺名", dataIndex: "name" },
      { title: "分类", dataIndex: "type", render: (value) => String(value ?? "") },
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
      { title: "列表展示", description: "下方标签和描述均可不填；不填写时前台不占位展示。", fields: () => <ArtistListFields /> },
      { title: "详情内容", description: "当前版本使用独立详情页引用，不再内嵌完整详情配置。", fields: () => <ArtistDetailFields /> },
      { title: "发布设置", fields: () => <ArtistPublishFields /> }
    ]
  }
};
