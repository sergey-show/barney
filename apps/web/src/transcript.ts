export type TranscriptItem = { id: string; kind: string; text: string; at: string };

export type TranscriptEntry =
  | { type: "work"; items: TranscriptItem[] }
  | { type: "row"; item: TranscriptItem };

const CHAT_KINDS = new Set(["user", "assistant"]);

export function groupTranscript(items: TranscriptItem[]): TranscriptEntry[] {
  const grouped: TranscriptEntry[] = [];
  let work: TranscriptItem[] = [];
  const flush = () => {
    if (!work.length) return;
    grouped.push({ type: "work", items: work });
    work = [];
  };
  for (const item of items) {
    if (CHAT_KINDS.has(item.kind)) {
      flush();
      grouped.push({ type: "row", item });
    } else {
      work.push(item);
    }
  }
  flush();
  return grouped;
}

export function isOpenWork(index: number, entries: TranscriptEntry[]): boolean {
  const entry = entries[index];
  if (entry?.type !== "work") return false;
  if (entries.slice(index + 1).some((item) => item.type === "row" && item.item.kind === "assistant")) {
    return false;
  }
  return !entries.slice(index + 1).some((item) => item.type === "work");
}

export function isPrelude(entry: { items: TranscriptItem[] }, index: number, entries: TranscriptEntry[]): boolean {
  return index === 0 && entry.items.every((item) => item.kind === "system") && entries.some((item) => item.type === "row");
}
