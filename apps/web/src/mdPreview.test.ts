import { expect, test } from "bun:test";
import { htmlToMd, mdToHtml, plainPreview } from "./mdPreview.ts";

test("mdToHtml renders headings, bold, and lists", () => {
  const html = mdToHtml("## Title\n\n**Мотив:** list\n\n- one\n- two");
  expect(html).toContain("<h2>");
  expect(html).toContain("<strong>");
  expect(html).toContain("<li>");
  expect(html).not.toContain("## Title");
});

test("htmlToMd reads headings, bold, and lists", () => {
  const text = (value: string) => ({ nodeType: 3, textContent: value, childNodes: [], children: [] });
  const el = (tag: string, kids: object[]) => ({
    nodeType: 1,
    tagName: tag,
    childNodes: kids,
    children: kids.filter((item) => (item as { nodeType: number }).nodeType === 1),
    textContent: kids.map((item) => (item as { textContent?: string }).textContent ?? "").join(""),
    getAttribute: () => null,
  });
  const root = el("DIV", [
    el("H2", [text("Internal State")]),
    el("P", [el("STRONG", [text("Мотив:")]), text(" анализ")]),
    el("UL", [el("LI", [text("контакт")])]),
  ]);
  const back = htmlToMd(root as unknown as ParentNode);
  expect(back).toContain("## Internal State");
  expect(back).toContain("**Мотив:**");
  expect(back).toMatch(/-\s*контакт/);
});

test("raw HTML in markdown is dropped", () => {
  expect(mdToHtml("<script>alert(1)</script>\n\nhello")).not.toContain("<script>");
});

test("plainPreview strips marks", () => {
  expect(plainPreview("## Hello **world**")).toBe("Hello world");
});
