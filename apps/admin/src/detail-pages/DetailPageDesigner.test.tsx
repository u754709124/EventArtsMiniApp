import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "detail-page-designer.css"), "utf8");

function rule(selector: string) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? "";
}

describe("DetailPageDesigner layout", () => {
  it("keeps preview and form panels independently scrollable inside the viewport", () => {
    expect(rule(".detail-designer")).toMatch(/height:\s*calc\(100dvh - 112px\)/);
    expect(rule(".detail-designer")).toMatch(/overflow:\s*hidden/);
    expect(rule(".detail-designer__preview")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".detail-designer__panel")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".detail-designer__toolbar")).toMatch(/position:\s*sticky/);
  });
});
