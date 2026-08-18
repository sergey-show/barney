import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Browser, Page } from "playwright";

export type BrowserView = {
  title: string;
  url: string;
  text: string;
};

export type BrowserShot = {
  path: string;
  url: string;
  title: string;
  jpeg: Buffer;
};

export class PlaywrightBrowser {
  private browser: Browser | null = null;
  private readonly pages = new Map<string, Page>();
  private readonly shots = new Map<string, BrowserShot>();
  private shotSeq = 0;

  async open(input: { runId: string; url: string; signal?: AbortSignal }): Promise<BrowserView> {
    const page = await this.pageFor(input.runId);
    await goto(page, input.url, input.signal);
    return readPage(page);
  }

  async read(runId: string): Promise<BrowserView> {
    const page = this.pages.get(runId);
    if (!page) throw new Error("no open page — call browser_open first");
    return readPage(page);
  }

  async screenshot(input: { runId: string; worktree: string; url?: string; fullPage?: boolean; signal?: AbortSignal }): Promise<BrowserShot> {
    if (input.url) await this.open({ runId: input.runId, url: input.url, signal: input.signal });
    const page = this.pages.get(input.runId);
    if (!page) throw new Error("no open page — call browser_open first");
    throwIfAborted(input.signal);
    const jpeg = await page.screenshot({ type: "jpeg", quality: 70, fullPage: Boolean(input.fullPage) });
    const rel = `browser-shots/shot-${++this.shotSeq}.jpg`;
    const abs = join(input.worktree, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, jpeg);
    const view = await readPage(page);
    const shot = { path: rel, url: view.url, title: view.title, jpeg };
    this.shots.set(input.runId, shot);
    return shot;
  }

  consumeShot(runId: string): BrowserShot | null {
    const shot = this.shots.get(runId) ?? null;
    this.shots.delete(runId);
    return shot;
  }

  current(runId: string): { url: string } | null {
    const page = this.pages.get(runId);
    if (!page) return null;
    return { url: page.url() };
  }

  async click(input: { runId: string; selector?: string; text?: string; signal?: AbortSignal }): Promise<BrowserView> {
    const page = this.requirePage(input.runId, input.signal);
    if (input.selector) await page.locator(input.selector).first().click({ timeout: 10_000 });
    else if (input.text) await page.getByText(input.text, { exact: false }).first().click({ timeout: 10_000 });
    else throw new Error("pass selector or text to click");
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    return readPage(page);
  }

  async fill(input: { runId: string; selector: string; value: string; signal?: AbortSignal }): Promise<BrowserView> {
    const page = this.requirePage(input.runId, input.signal);
    if (!input.selector.trim()) throw new Error("selector is required");
    await page.locator(input.selector).first().fill(input.value, { timeout: 10_000 });
    return readPage(page);
  }

  async press(input: { runId: string; key: string; signal?: AbortSignal }): Promise<BrowserView> {
    const page = this.requirePage(input.runId, input.signal);
    if (!input.key.trim()) throw new Error("key is required, e.g. Enter or Tab");
    await page.keyboard.press(input.key);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    return readPage(page);
  }

  async scroll(input: { runId: string; dy?: number; signal?: AbortSignal }): Promise<BrowserView> {
    const page = this.requirePage(input.runId, input.signal);
    const dy = Number.isFinite(input.dy) ? Number(input.dy) : 600;
    await page.mouse.wheel(0, dy);
    return readPage(page);
  }

  async close(runId: string): Promise<void> {
    const page = this.pages.get(runId);
    this.pages.delete(runId);
    this.shots.delete(runId);
    await page?.close().catch(() => undefined);
    if (this.pages.size === 0 && this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  private requirePage(runId: string, signal?: AbortSignal): Page {
    throwIfAborted(signal);
    const page = this.pages.get(runId);
    if (!page || page.isClosed()) throw new Error("no open page — call browser_open first");
    return page;
  }

  private async pageFor(runId: string): Promise<Page> {
    const existing = this.pages.get(runId);
    if (existing && !existing.isClosed()) return existing;
    const browser = await this.ensureBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(20_000);
    this.pages.set(runId, page);
    return page;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    try {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: true });
      return this.browser;
    } catch (err) {
      throw new Error(
        `browser unavailable: ${err instanceof Error ? err.message : String(err)}. Install with: bunx playwright install chromium`,
      );
    }
  }
}

async function goto(page: Page, raw: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const url = normalizeUrl(raw);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
}

async function readPage(page: Page): Promise<BrowserView> {
  const title = await page.title().catch(() => "");
  const url = page.url();
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  return { title, url, text: text.replace(/\s+\n/g, "\n").trim().slice(0, 6000) };
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^[a-z]+:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`invalid url: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http(s) urls are allowed");
  }
  return parsed.toString();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("step interrupted");
}
