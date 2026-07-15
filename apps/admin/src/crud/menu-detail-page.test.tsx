// @vitest-environment jsdom

import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Form, type FormInstance } from "antd";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildCrudSaveRequest, configs, prepareCrudEditValues } from "./config";

vi.mock("../media/MediaField", () => ({
  MediaField: () => <div data-testid="mock-media-field" />
}));

vi.mock("../detail-pages/DetailPageReferenceField", () => ({
  DetailPageReferenceField: ({
    value,
    detailPageType,
    disabled
  }: {
    value?: number | null;
    detailPageType?: string;
    disabled?: boolean;
  }) => (
    <div
      data-testid="mock-detail-page-reference"
      data-value={value ?? ""}
      data-detail-type={detailPageType ?? ""}
      data-disabled={String(Boolean(disabled))}
    />
  )
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
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

let form: FormInstance;

function Harness({ initialValues }: { initialValues: Record<string, unknown> }) {
  const [instance] = Form.useForm();
  form = instance;
  return <Form form={instance} initialValues={initialValues}>{configs["menu-items"].fields(instance, null)}</Form>;
}

async function chooseDetailType(label: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "菜单详情页类型" }));
  fireEvent.click(await screen.findByText(label, { selector: ".ant-select-item-option-content" }));
}

describe("direct detail-page menu form", () => {
  it("renders the cascade, filters by selected type, and clears an incompatible target", async () => {
    render(
      <Harness
        initialValues={{
          type: "detail_page",
          configJson: { detailPageType: "banner_rich_text", detailPageId: 9 }
        }}
      />
    );

    const reference = await screen.findByTestId("mock-detail-page-reference");
    await waitFor(() => expect(reference.dataset.detailType).toBe("banner_rich_text"));
    expect(reference.dataset.value).toBe("9");
    expect(reference.dataset.disabled).toBe("false");

    await chooseDetailType("单富文本");
    await waitFor(() => expect(form.getFieldValue(["configJson", "detailPageType"])).toBe("rich_text"));
    expect(form.getFieldValue(["configJson", "detailPageId"])).toBeNull();
    expect(screen.getByTestId("mock-detail-page-reference").dataset.detailType).toBe("rich_text");
  });

  it("disables target selection until a type is chosen and requires both fields", async () => {
    render(<Harness initialValues={{ type: "detail_page", configJson: {} }} />);
    expect((await screen.findByTestId("mock-detail-page-reference")).dataset.disabled).toBe("true");

    await expect(form.validateFields()).rejects.toMatchObject({ errorFields: expect.any(Array) });
    const errors = form.getFieldsError()
      .flatMap((field) => field.errors);
    expect(errors).toEqual(expect.arrayContaining(["请选择详情页类型", "请选择对应详情页"]));
  });

  it("normalizes save payloads to the strict direct-detail config and round-trips edit values", () => {
    const request = buildCrudSaveRequest(configs["menu-items"], { id: 5 }, {
      id: 5,
      text: "品牌故事",
      iconAssetId: 18,
      iconUrl: "/uploads/icon.png",
      type: "detail_page",
      configJson: {
        detailPageType: "rich_text",
        detailPageId: 12
      },
      showOnHome: true,
      sortOrder: 8,
      status: "enabled"
    });

    expect(request).toEqual({
      path: "/api/admin/menu-items/5",
      method: "PUT",
      body: {
        text: "品牌故事",
        iconAssetId: 18,
        type: "detail_page",
        configJson: { detailPageType: "rich_text", detailPageId: 12 },
        showOnHome: true,
        sortOrder: 8,
        status: "enabled"
      }
    });
    expect(prepareCrudEditValues({
      id: 5,
      type: "detail_page",
      configJson: JSON.stringify({ detailPageType: "rich_text", detailPageId: 12 })
    }).configJson).toEqual({ detailPageType: "rich_text", detailPageId: 12 });
  });

  it("clears direct-detail config when the top-level menu type changes", async () => {
    render(
      <Harness
        initialValues={{
          type: "detail_page",
          configJson: { detailPageType: "rich_text", detailPageId: 12 }
        }}
      />
    );

    const typeSelect = screen.getByTestId("menu-type-select");
    fireEvent.mouseDown(typeSelect.querySelector(".ant-select-selector") ?? typeSelect);
    fireEvent.click(await screen.findByText("联系我们", { selector: ".ant-select-item-option-content" }));
    await act(async () => undefined);

    expect(form.getFieldValue("type")).toBe("contact");
    expect(form.getFieldValue(["configJson", "detailPageId"])).toBeUndefined();
    expect(form.getFieldValue(["configJson", "detailPageType"])).toBeUndefined();
  });
});
