import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { referencePath } from "./DetailPageDesigner";

const css = readFileSync(resolve(import.meta.dirname, "detail-page-designer.css"), "utf8");
const richTextCss = readFileSync(resolve(import.meta.dirname, "rich-text-editor.css"), "utf8");

function rule(selector: string, stylesheet = css) {
  const match = stylesheet.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? "";
}

describe("DetailPageDesigner layout", () => {
  it("keeps preview and form panels independently scrollable inside the viewport", () => {
    expect(rule(".detail-designer")).toMatch(/height:\s*calc\(100dvh - 112px\)/);
    expect(rule(".detail-designer")).toMatch(/overflow:\s*hidden/);
    expect(rule(".detail-designer__preview")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".detail-designer__panel")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".detail-designer__save-status")).toMatch(/white-space:\s*nowrap/);
    expect(css).not.toContain(".detail-designer__toolbar");
  });

  it("keeps a generous input area below long rich text content", () => {
    expect(rule(".rich-text-editor .tiptap.ProseMirror", richTextCss)).toMatch(/padding:\s*16px 16px 128px/);
  });

  it("routes menu references back to menu management", () => {
    expect(referencePath({ sourceType: "menu", sourceId: 7, sourceName: "品牌故事" })).toBe("/menu-items");
    expect(referencePath({ sourceType: "activity_case", sourceId: 8, sourceName: "活动案例" })).toBe("/cases");
  });
});
