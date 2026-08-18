import type { ResearchHit } from "../../application/ports.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function parseSearchHits(html: string): ResearchHit[] {
  const hits: ResearchHit[] = [];
  const seen = new Set<string>();
  const blocks = html.matchAll(
    /<a[^>]+(?:class="[^"]*result__a[^"]*"|rel="nofollow")[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  );
  for (const match of blocks) {
    const url = unwrapDuckUrl(decodeHtml(match[1] ?? ""));
    const title = stripTags(match[2] ?? "").trim();
    if (!url || !title || seen.has(url) || !/^https?:\/\//i.test(url)) continue;
    if (/duckduckgo\.com|google\.[a-z]+\/search/i.test(url)) continue;
    seen.add(url);
    hits.push({ title, url, snippet: "" });
    if (hits.length >= 8) break;
  }
  const snippets = [...html.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|span|div)>/gi)]
    .map((match) => stripTags(match[1] ?? "").trim())
    .filter(Boolean);
  for (let i = 0; i < hits.length && i < snippets.length; i += 1) {
    hits[i] = { ...hits[i]!, snippet: snippets[i] ?? "" };
  }
  return hits;
}

export function unwrapDuckUrl(raw: string): string {
  try {
    const href = raw.startsWith("//") ? `https:${raw}` : raw;
    const parsed = new URL(href);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname === "/l/") {
      return parsed.searchParams.get("uddg") ?? raw;
    }
    return href;
  } catch {
    return raw;
  }
}

export function formatHits(hits: ResearchHit[]): string {
  if (!hits.length) return "(no web hits)";
  return hits.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}${hit.snippet ? `\n   ${hit.snippet}` : ""}`).join("\n");
}

export class DuckDuckGoSearch {
  async lookup(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const lite = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, signal);
    let hits = lite ? parseSearchHits(lite) : [];
    if (!hits.length) {
      const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, signal);
      hits = html ? parseSearchHits(html) : [];
    }
    if (!hits.length) hits = await wikipediaHits(q, signal);
    return hits.slice(0, 8);
  }
}

export class CompositeResearch {
  constructor(
    private readonly docs: { search(query: string, signal?: AbortSignal): Promise<string> },
    private readonly web: { lookup(query: string, signal?: AbortSignal): Promise<ResearchHit[]> },
  ) {}

  async lookup(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
    return this.web.lookup(query, signal);
  }

  async search(query: string, signal?: AbortSignal): Promise<string> {
    const [docs, hits] = await Promise.all([
      this.docs.search(query, signal).catch((err) => `docs: ${String(err)}`),
      this.web.lookup(query, signal).catch(() => [] as ResearchHit[]),
    ]);
    return [`Docs:\n${docs}`, `Web:\n${formatHits(hits)}`].join("\n\n");
  }
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

async function wikipediaHits(query: string, signal?: AbortSignal): Promise<ResearchHit[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json&search=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "user-agent": UA }, signal });
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[], string[], string[]];
    const titles = json[1] ?? [];
    const snippets = json[2] ?? [];
    const links = json[3] ?? [];
    return titles.map((title, index) => ({
      title,
      url: links[index] ?? "",
      snippet: snippets[index] ?? "",
    })).filter((hit) => hit.url);
  } catch {
    return [];
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
