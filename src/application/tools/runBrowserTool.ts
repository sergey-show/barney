import type { BrowserPort } from "../ports.ts";
import { normalizeUrl } from "../../infrastructure/browser/PlaywrightBrowser.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runBrowserTool(
  browser: BrowserPort,
  call: ToolCall,
  ctx: { runId: string; worktree: string; signal?: AbortSignal; show: (url: string, shot?: string) => void },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "");
  try {
    switch (call.name) {
      case "browser_open": {
        const view = await browser.open({ runId: ctx.runId, url: str("url"), signal: ctx.signal });
        return [`opened ${view.url}`, view.title && `title: ${view.title}`, view.text || "(no visible text)"].filter(Boolean).join("\n");
      }
      case "browser_read": {
        const view = await browser.read(ctx.runId);
        return [`${view.url}`, view.title && `title: ${view.title}`, view.text || "(no visible text)"].filter(Boolean).join("\n");
      }
      case "browser_screenshot": {
        const shot = await browser.screenshot({
          runId: ctx.runId,
          worktree: ctx.worktree,
          url: str("url") || undefined,
          fullPage: Boolean(args.fullPage),
          signal: ctx.signal,
        });
        return `screenshot ${shot.path}\n${shot.url}\ntitle: ${shot.title}\nThe image is attached for you to look at. Do not show this to the user unless they asked.`;
      }
      case "browser_show": {
        const url = str("url") || browser.current(ctx.runId)?.url;
        if (!url) return "error: pass url or browser_open first";
        if (str("url")) await browser.open({ runId: ctx.runId, url: str("url"), signal: ctx.signal });
        await showShot(browser, ctx, normalizeUrl(url));
        return `showing ${url} to the user in a portal modal`;
      }
      case "browser_click": {
        const view = await browser.click({
          runId: ctx.runId,
          selector: str("selector") || undefined,
          text: str("text") || undefined,
          signal: ctx.signal,
        });
        return formatView("clicked", view);
      }
      case "browser_fill": {
        const view = await browser.fill({
          runId: ctx.runId,
          selector: str("selector"),
          value: str("value"),
          signal: ctx.signal,
        });
        return formatView(`filled ${str("selector")}`, view);
      }
      case "browser_press": {
        const view = await browser.press({ runId: ctx.runId, key: str("key"), signal: ctx.signal });
        return formatView(`pressed ${str("key")}`, view);
      }
      case "browser_scroll": {
        const dy = Number(str("dy") || "600");
        const view = await browser.scroll({ runId: ctx.runId, dy, signal: ctx.signal });
        return formatView(`scrolled ${dy}`, view);
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function showShot(
  browser: BrowserPort,
  ctx: { runId: string; worktree: string; signal?: AbortSignal; show: (url: string, shot?: string) => void },
  url: string,
): Promise<void> {
  const shot = await browser.screenshot({ runId: ctx.runId, worktree: ctx.worktree, signal: ctx.signal });
  ctx.show(url || shot.url, shot.path);
}

function formatView(action: string, view: { url: string; title: string; text: string }): string {
  return [`${action} → ${view.url}`, view.title && `title: ${view.title}`, view.text || "(no visible text)"].filter(Boolean).join("\n");
}
