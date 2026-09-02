export type ReplySource = {
  href: string;
  title: string;
  host: string;
};

/** Clean assistant markdown for display and collect source links. */
export function prepareAssistantReply(text: string): { body: string; sources: ReplySource[] } {
  const sources = collectSources(text);
  const body = stripToolPageDump(text).trim();
  return { body, sources };
}

export function collectSources(text: string): ReplySource[] {
  const found = new Map<string, ReplySource>();
  const add = (rawHref: string, label?: string) => {
    const href = normalizeHref(rawHref);
    if (!href || found.has(href)) return;
    found.set(href, {
      href,
      title: sourceTitle(href, label),
      host: hostOf(href),
    });
  };

  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi)) {
    add(match[2] ?? "", match[1]);
  }
  for (const match of text.matchAll(/(?<![(\["])(https?:\/\/[^\s<>)"'\]]+)/gi)) {
    add(match[1] ?? "");
  }
  return [...found.values()];
}

/** Drop pasted tool/page chrome that leaked after the answer. */
export function stripToolPageDump(text: string): string {
  const markers = [
    /\nopened https?:\/\//i,
    /\nBibliographic Explorer\b/i,
    /\nConnected Papers\b/i,
    /\nscite Smart Citations\b/i,
    /\nWhich authors of this paper\b/i,
    /\nWe gratefully acknowledge support\b/i,
    /\n\[Submitted on /i,
    /\nSubjects: Artificial Intelligence\b/i,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match?.index != null && match.index > 80 && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).replace(/\n{3,}/g, "\n\n").trimEnd();
}

function normalizeHref(raw: string): string | null {
  const href = raw.replace(/[.,;:!?)]+$/, "").trim();
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    if (!url.hostname.includes(".")) return null;
    return href;
  } catch {
    return null;
  }
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceTitle(href: string, label?: string): string {
  const clean = (label ?? "").replace(/\s+/g, " ").trim();
  if (clean && !/^https?:\/\//i.test(clean) && clean.length < 120) return clean;
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "arxiv.org") {
      const id = url.pathname.match(/\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1];
      if (id) return `arXiv:${id}`;
    }
    const last = url.pathname.split("/").filter(Boolean).at(-1);
    if (last && last.length > 2 && last.length < 80) return decodeURIComponent(last);
    return host;
  } catch {
    return clean || href;
  }
}
