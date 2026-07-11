// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Button, Form, type FormInstance } from "antd";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detailPageTypeDefinitions,
  type DetailPageConfigDto,
  type MediaAssetDto
} from "@event-arts/shared";
import { request } from "../api";
import { DetailPageConfigFields } from "./DetailPageConfigFields";
import {
  detailFieldPaths,
  normalizeDetailPageFormValue
} from "./detail-page-form-utils";

vi.mock("../api", () => ({ request: vi.fn() }));

vi.mock("./DetailBannerField", () => ({
  detailBannerFormRules: [{ required: true, message: "请至少选择 1 张详情页 BANNER" }],
  DetailBannerField: ({ value = [], onChange }: { value?: number[]; onChange?: (value: number[]) => void }) => (
    <div data-testid="detail-banner-field">
      <span>{value.join(",")}</span>
      <button type="button" onClick={() => onChange?.([...value, 99])}>添加测试 BANNER</button>
    </div>
  )
}));

vi.mock("./RichTextEditorField", () => ({
  RichTextEditorField: ({ value = "", onChange }: { value?: string; onChange?: (value: string) => void }) => (
    <div data-testid="detail-rich-text-editor">
      <span>{value}</span>
      <button type="button" onClick={() => onChange?.("<p>编辑后正文</p>")}>编辑正文</button>
    </div>
  )
}));

vi.mock("./DetailPagePreview", () => ({
  DetailPagePreview: () => <button type="button" data-testid="detail-page-preview">移动端预览</button>
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) => getComputedStyle(element)) as typeof window.getComputedStyle;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

let form: FormInstance;

function Harness({
  initialValues,
  initialDetailPage,
  ownerPreviewData,
  onFinish = vi.fn()
}: {
  initialValues?: Record<string, unknown>;
  initialDetailPage?: DetailPageConfigDto | null;
  ownerPreviewData?: { title?: string; avatarAssetId?: number | null; coverAssetId?: number | null; bodyAssetIds?: number[] };
  onFinish?: (value: unknown) => void;
}) {
  const [instance] = Form.useForm();
  form = instance;
  useEffect(() => undefined, []);
  return (
    <Form form={instance} initialValues={initialValues} onFinish={onFinish}>
      <DetailPageConfigFields
        form={instance}
        ownerType="artist"
        ownerPreviewData={ownerPreviewData ?? { title: "林然" }}
        initialDetailPage={initialDetailPage}
      />
      <Button htmlType="submit">保存</Button>
    </Form>
  );
}

async function chooseType(label: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "详情页类型" }));
  const option = await screen.findByText(label, { selector: ".ant-select-item-option-content" });
  fireEvent.click(option);
}

describe("DetailPageConfigFields", () => {
  it("mounts only the required type selector and hint until the user explicitly chooses a type", async () => {
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);

    expect(screen.getByTestId("detail-page-type")).toBeTruthy();
    expect(screen.getByTestId("detail-page-empty-hint").textContent).toContain("请先选择详情页类型");
    expect(screen.queryByTestId("detail-hero-subtitle")).toBeNull();
    expect(screen.queryByTestId("detail-banner-field")).toBeNull();
    expect(screen.queryByTestId("detail-rich-text-editor")).toBeNull();
    expect(screen.queryByTestId("detail-page-preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(onFinish).not.toHaveBeenCalled());
    expect(await screen.findByText("请选择详情页类型")).toBeTruthy();
  });

  it("renders exactly the fields declared for each type", async () => {
    render(<Harness />);
    await chooseType("BANNER + 富文本");
    expect(await screen.findByTestId("detail-hero-subtitle")).toBeTruthy();
    expect(screen.getByTestId("detail-banner-field")).toBeTruthy();
    expect(await screen.findByTestId("detail-rich-text-editor")).toBeTruthy();
    expect(screen.getByTestId("detail-page-preview")).toBeTruthy();

    cleanup();
    render(<Harness />);
    await chooseType("单富文本");
    expect(screen.queryByTestId("detail-hero-subtitle")).toBeNull();
    expect(screen.queryByTestId("detail-banner-field")).toBeNull();
    expect(screen.getByTestId("detail-rich-text-editor")).toBeTruthy();
    expect(screen.getByTestId("detail-page-preview")).toBeTruthy();
  });

  it("derives mounted and validated production fields from the shared registry configFields", async () => {
    const definition = detailPageTypeDefinitions.banner_rich_text as unknown as {
      configFields: readonly ("heroSubtitle" | "banners" | "richText")[];
    };
    const originalFields = definition.configFields;
    definition.configFields = ["richText"];
    try {
      render(
        <Harness
          initialValues={{
            detailPage: {
              type: "banner_rich_text",
              heroSubtitle: "应被注册表隐藏",
              bannerAssetIds: [11],
              richTextHtml: "<p>正文</p>"
            }
          }}
        />
      );
      expect(await screen.findByTestId("detail-rich-text-editor")).toBeTruthy();
      expect(screen.queryByTestId("detail-hero-subtitle")).toBeNull();
      expect(screen.queryByTestId("detail-banner-field")).toBeNull();
      expect(detailFieldPaths("banner_rich_text")).toEqual([
        ["detailPage", "type"],
        ["detailPage", "richTextHtml"]
      ]);
    } finally {
      definition.configFields = originalFields;
    }
  });

  it("cancels or confirms banner-to-rich switching without losing HTML and strips hidden fields", async () => {
    render(
      <Harness
        initialValues={{
          detailPage: {
            type: "banner_rich_text",
            heroSubtitle: "温暖而专业",
            bannerAssetIds: [11, 12],
            richTextHtml: "<p>保留的正文</p>"
          }
        }}
      />
    );

    await chooseType("单富文本");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("保存后解除 BANNER 资源关联");
    expect(form.getFieldValue(["detailPage", "type"])).toBe("banner_rich_text");
    fireEvent.click(within(dialog).getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(form.getFieldValue(["detailPage", "type"])).toBe("banner_rich_text");
    expect(form.getFieldValue(["detailPage", "richTextHtml"])).toBe("<p>保留的正文</p>");

    await chooseType("单富文本");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /确\s*认\s*切\s*换/ }));
    await waitFor(() => expect(form.getFieldValue(["detailPage", "type"])).toBe("rich_text"));
    expect(form.getFieldValue(["detailPage", "richTextHtml"])).toBe("<p>保留的正文</p>");
    expect(screen.queryByTestId("detail-banner-field")).toBeNull();
    expect(normalizeDetailPageFormValue(form.getFieldValue("detailPage"))).toEqual({
      type: "rich_text",
      richTextHtml: "<p>保留的正文</p>"
    });
  });

  it("switches rich-to-banner immediately, preserves HTML, and makes subtitle and banners required", async () => {
    const onFinish = vi.fn();
    render(
      <Harness
        onFinish={onFinish}
        initialValues={{ detailPage: { type: "rich_text", richTextHtml: "<p>原正文</p>" } }}
      />
    );
    await chooseType("BANNER + 富文本");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(form.getFieldValue(["detailPage", "richTextHtml"])).toBe("<p>原正文</p>");
    expect(await screen.findByTestId("detail-hero-subtitle")).toBeTruthy();
    expect(screen.getByTestId("detail-banner-field")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(await screen.findByText("请输入 BANNER 宣传语")).toBeTruthy();
    expect(await screen.findByText("请至少选择 1 张详情页 BANNER")).toBeTruthy();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("hydrates a migrated DTO through the component and clears it when the next record has no detail", async () => {
    const dto: DetailPageConfigDto = {
      type: "banner_rich_text",
      typeLabel: "BANNER + 富文本",
      rendererKey: "bannerRichText",
      schemaVersion: 1,
      heroSubtitle: "迁移宣传语",
      banners: [
        { id: 2, assetId: 22, url: "/uploads/22.webp", width: 1500, height: 760, sortOrder: 1 },
        { id: 1, assetId: 21, url: "/uploads/21.webp", width: 1500, height: 760, sortOrder: 0 }
      ],
      richTextHtml: "<p>迁移正文</p>",
      blocks: [{ type: "richText", html: "<p>迁移正文</p>" }]
    };
    const view = render(<Harness initialDetailPage={dto} />);
    expect(await screen.findByTestId("detail-banner-field")).toBeTruthy();
    await waitFor(() => expect(form.getFieldValue(["detailPage"])).toEqual({
      type: "banner_rich_text",
      heroSubtitle: "迁移宣传语",
      bannerAssetIds: [21, 22],
      richTextHtml: "<p>迁移正文</p>"
    }));

    view.rerender(<Harness initialDetailPage={null} />);
    await waitFor(() => expect(screen.getByTestId("detail-page-empty-hint").textContent).toContain("详情待补充"));
    expect(screen.getByTestId("detail-page-empty-hint").textContent).toContain("请先选择详情页类型");
    expect(screen.queryByTestId("detail-hero-subtitle")).toBeNull();
    expect(screen.queryByTestId("detail-banner-field")).toBeNull();
    expect(screen.queryByTestId("detail-rich-text-editor")).toBeNull();
    expect(screen.queryByTestId("detail-page-preview")).toBeNull();
    expect(form.getFieldValue(["detailPage"])).toBeUndefined();
  });

  it("confirms template overwrite and hydrates it with real selected asset ids and canonical URLs", async () => {
    const asset: MediaAssetDto = {
      id: 7,
      resourceName: "人员封面",
      originalName: "artist.webp",
      md5: "md5",
      mimeType: "image/webp",
      mediaType: "image",
      url: "/uploads/artist.webp",
      width: 1200,
      height: 800,
      size: 100,
      storageType: "local",
      tags: [],
      referenceCount: 0,
      inUse: false,
      createdBy: 1,
      createdByName: "admin",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    };
    vi.mocked(request).mockResolvedValue(asset);
    render(
      <Harness
        initialValues={{ detailPage: { type: "rich_text", richTextHtml: "<p>已有内容</p>" } }}
        ownerPreviewData={{ title: "林然", avatarAssetId: 7 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "应用人员参考模板" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("覆盖当前富文本内容");
    fireEvent.click(within(dialog).getByRole("button", { name: /取\s*消/ }));
    expect(form.getFieldValue(["detailPage", "richTextHtml"])).toBe("<p>已有内容</p>");

    fireEvent.click(screen.getByRole("button", { name: "应用人员参考模板" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /应\s*用\s*模\s*板/ }));
    await waitFor(() => {
      const html = form.getFieldValue(["detailPage", "richTextHtml"]) as string;
      expect(html).toContain('data-media-asset-id="7"');
      expect(html).toContain('src="/uploads/artist.webp"');
      expect(html).not.toMatch(/blob:|data:|\/tmp\//);
    });
  });
});
