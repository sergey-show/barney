const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "was",
]);

export function queryTerms(query: string): string[] {
  const raw = query.toLowerCase().match(/[a-zа-яё][a-zа-яё0-9._-]{2,}/gi) ?? [];
  return [...new Set(raw.map((item) => item.toLowerCase()))].filter((term) => !STOP.has(term));
}

export function clipPage(text: string, query: string, max = 1800): string {
  const compact = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!compact) return "";
  if (compact.length <= max) return compact;
  const terms = queryTerms(query);
  const windows = terms.length ? windowsAround(compact, terms, max) : "";
  if (windows) return windows;
  const body = skipChrome(compact);
  return body.length <= max ? body : `${body.slice(0, max)}…`;
}

function windowsAround(text: string, terms: string[], max: number): string {
  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const term of terms) {
    let from = 0;
    while (hits.length < 12) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      hits.push(at);
      from = at + term.length;
    }
  }
  if (!hits.length) return "";
  hits.sort((a, b) => a - b);
  const span = Math.max(280, Math.floor(max / Math.min(hits.length, 3)));
  const ranges: Array<{ start: number; end: number }> = [];
  for (const hit of hits) {
    const start = Math.max(0, hit - Math.floor(span / 4));
    const end = Math.min(text.length, hit + span);
    const last = ranges.at(-1);
    if (last && start <= last.end + 40) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  let out = ranges.map((range) => text.slice(range.start, range.end).trim()).join("\n…\n");
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

function skipChrome(text: string): string {
  const idx = text.search(/\b(Fetching|Timeout|Usage|Example|To [a-z]|## |# )/);
  return idx > 80 ? text.slice(idx) : text;
}
