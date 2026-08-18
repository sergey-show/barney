import { expect, test } from "bun:test";
import type { BrowserPort } from "../ports.ts";
import { runBrowserTool } from "./runBrowserTool.ts";

function stubBrowser(): BrowserPort & { shown: Array<{ url: string; shot?: string }> } {
  const shown: Array<{ url: string; shot?: string }> = [];
  const view = { title: "Example", url: "https://example.com", text: "hello" };
  return {
    shown,
    open: async () => view,
    read: async () => view,
    screenshot: async () => ({ path: "browser-shots/shot-1.jpg", url: view.url, title: view.title, jpeg: Buffer.from("x") }),
    consumeShot: () => null,
    current: () => ({ url: view.url }),
    click: async () => view,
    fill: async () => view,
    press: async () => view,
    scroll: async () => view,
    close: async () => undefined,
  };
}

test("agent browse stays hidden; browser_show is the only user reveal", async () => {
  const browser = stubBrowser();
  const shown: Array<[string, string?]> = [];
  const ctx = { runId: "run_1", worktree: "/tmp", show: (url: string, shot?: string) => shown.push([url, shot]) };
  await runBrowserTool(browser, { id: "1", name: "browser_open", arguments: { url: "https://example.com" } }, ctx);
  await runBrowserTool(browser, { id: "2", name: "browser_click", arguments: { text: "Go" } }, ctx);
  await runBrowserTool(browser, { id: "3", name: "browser_screenshot", arguments: {} }, ctx);
  expect(shown).toEqual([]);
  await runBrowserTool(browser, { id: "4", name: "browser_show", arguments: {} }, ctx);
  expect(shown).toHaveLength(1);
  expect(shown[0]?.[0]).toBe("https://example.com/");
});
