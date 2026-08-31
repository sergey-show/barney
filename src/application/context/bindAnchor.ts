import { extractAnchors } from "./packSession.ts";

const URL_KEYS = ["url", "href", "uri"];

export function bindUrl(url: string, anchors: string[]): string {
  const raw = url.trim();
  if (!raw) return raw;
  const http = unique(anchors.filter((item) => /^https?:\/\//i.test(item)));
  if (http.some((anchor) => sameUrl(raw, anchor))) return raw;
  const shortPath = expandShortPathId(raw, http);
  if (shortPath) return shortPath;
  // Complete `/news/8` must not be upgraded to an unrelated `/articles/1070220` on the same host.
  if (isShortNumericPathId(raw) && isCompleteUrl(raw) && !looksBroken(raw)) return raw;
  const longer = http.find((anchor) => sharesStem(raw, anchor) && digits(anchor).length > digits(raw).length);
  if (longer) return longer;
  if (!looksBroken(raw) && isCompleteUrl(raw)) return raw;
  if (http.length === 1 && looksBroken(raw)) return http[0]!;
  return raw;
}

export function bindToolArgs(
  name: string,
  args: Record<string, unknown>,
  anchors: string[],
): Record<string, unknown> {
  if (!anchors.length) return args;
  const next = { ...args };
  for (const key of URL_KEYS) {
    if (typeof next[key] === "string") next[key] = bindUrl(String(next[key]), anchors);
  }
  if (name === "shell" && typeof next.command === "string") {
    next.command = String(next.command).replace(/https?:\/\/[^\s"'`]+/gi, (url) => bindUrl(url, anchors));
  }
  return next;
}

export function goalAnchors(...parts: string[]): string[] {
  return extractAnchors(...parts).filter((item) => /^https?:\/\//i.test(item));
}

function looksBroken(url: string): boolean {
  if (/\.\.\.|:\.|\/\/\d+\.:/.test(url)) return true;
  if (/\s/.test(url)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (/^\d+(?:\.\d+){0,2}$/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

/** `/news/8` → `/news/1070220` when the longer id is a session anchor on the same host+prefix. */
function expandShortPathId(url: string, anchors: string[]): string | undefined {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    if (!/^\d{1,4}$/.test(last)) return;
    const prefix = `/${parts.slice(0, -1).join("/")}/`;
    return anchors.find((anchor) => {
      try {
        const other = new URL(anchor);
        if (other.hostname !== parsed.hostname) return false;
        const otherParts = other.pathname.split("/").filter(Boolean);
        const otherLast = otherParts.at(-1) ?? "";
        if (!/^\d{5,}$/.test(otherLast)) return false;
        if (otherLast.length <= last.length) return false;
        const otherPrefix = `/${otherParts.slice(0, -1).join("/")}/`;
        return otherPrefix === prefix;
      } catch {
        return false;
      }
    });
  } catch {
    return;
  }
}

function isShortNumericPathId(url: string): boolean {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return /^\d{1,4}$/.test(last);
  } catch {
    return false;
  }
}

function isCompleteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.hostname.includes(".") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname));
  } catch {
    return false;
  }
}

function sharesStem(url: string, anchor: string): boolean {
  const left = digits(url);
  const right = digits(anchor);
  if (left.length >= 6 && (right.startsWith(left) || left.startsWith(right.slice(0, left.length)))) return true;
  const a = compact(url);
  const b = compact(anchor);
  const n = Math.min(a.length, b.length, 18);
  return n >= 10 && (a.startsWith(b.slice(0, n)) || b.startsWith(a.slice(0, n)));
}

function sameUrl(left: string, right: string): boolean {
  return compact(left) === compact(right);
}

function compact(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function digits(url: string): string {
  return url.replace(/\D/g, "");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
