import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8");
const notificationCss = readFileSync(resolve(import.meta.dirname, "../notifications/notifications.css"), "utf8");

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

  it("uses four, two, and one columns for EdgeOne metrics across desktop, tablet, and mobile", () => {
    expect(rule(".dashboard-metric-grid--edgeone")).toMatch(/grid-template-columns:\s*repeat\(4,/);
    expect(css).toMatch(/@media \(max-width:\s*900px\)[\s\S]*?\.dashboard-metric-grid--edgeone\s*\{[^}]*repeat\(2,/);
    expect(css).toMatch(/@media \(max-width:\s*767px\)[\s\S]*?\.dashboard-metric-grid--edgeone\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*?\.dashboard-metric-grid--local\s*\{[^}]*grid-template-columns:\s*1fr/);
  });

  it("keeps the history action touch-friendly and notification motion accessible", () => {
    expect(rule(".admin-header__history.ant-btn")).toMatch(/width:\s*44px/);
    expect(rule(".admin-header__history.ant-btn")).toMatch(/height:\s*44px/);
    expect(notificationCss).toMatch(/transform-origin:\s*right center/);
    expect(notificationCss).toMatch(/animation:\s*notification-progress 5000ms linear forwards/);
    expect(notificationCss).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });
});
