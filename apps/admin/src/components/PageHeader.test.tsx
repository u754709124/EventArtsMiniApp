// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders breadcrumbs above a stable title and action row", () => {
    const { container } = render(
      <PageHeader
        title="案例管理"
        breadcrumbs={["内容管理", "案例管理"]}
        description="管理前台展示的案例"
        extra={<button type="button">新增</button>}
      />
    );

    const header = container.querySelector(".page-header");
    const breadcrumb = container.querySelector(".page-header__breadcrumb");
    const body = container.querySelector(".page-header__body");
    const copy = container.querySelector(".page-header__copy");
    const extra = container.querySelector(".page-header__extra");

    expect(header).toBeTruthy();
    expect(breadcrumb?.textContent).toContain("内容管理");
    expect(body?.contains(copy)).toBe(true);
    expect(body?.contains(extra)).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "案例管理" })).toBeTruthy();
    expect(screen.getByText("管理前台展示的案例")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新增" })).toBeTruthy();
  });

  it("does not render empty optional regions", () => {
    const { container } = render(<PageHeader title="数据看板" />);

    expect(container.querySelectorAll("h2")).toHaveLength(1);
    expect(container.querySelector(".page-header__breadcrumb")).toBeNull();
    expect(container.querySelector(".page-header__description")).toBeNull();
    expect(container.querySelector(".page-header__extra")).toBeNull();
  });
});
