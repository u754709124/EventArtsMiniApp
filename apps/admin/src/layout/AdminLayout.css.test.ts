import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8");

function rule(selector: string) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? "";
}

describe("AdminLayout CSS contract", () => {
  it("keeps the sidebar sticky inside the main layout", () => {
    const sider = rule(".admin-layout .ant-layout-sider");

    expect(sider).toMatch(/position:\s*sticky/);
    expect(sider).toMatch(/top:\s*0/);
    expect(sider).toMatch(/height:\s*100dvh/);
  });

  it("bounds wide table overflow to the right-side content column", () => {
    expect(rule(".admin-main")).toMatch(/min-width:\s*0/);
    expect(rule(".admin-content")).toMatch(/min-width:\s*0/);
    expect(rule(".page-stack")).toMatch(/min-width:\s*0/);
    expect(css).toMatch(/\.list-card,\s*\.list-card \.ant-card-body\s*\{[^}]*min-width:\s*0/s);
    expect(css).not.toMatch(/\.admin-layout\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).not.toMatch(/\.admin-content\s*\{[^}]*overflow-x:\s*auto/s);
  });
});
