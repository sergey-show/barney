/**
 * Consolidate durable memory for new sessions: preferences vs task-scoped,
 * evidence-only, secret-safe, size-budgeted.
 */

export type MemoryConsolidatorItem = {
  key: string;
  title: string;
  body: string;
  tags?: string[];
  updatedAt?: string;
  scope?: "preference" | "task" | "study" | "policy" | "other";
};

export type ConsolidatedMemory = {
  summary: string;
  bytes: number;
  kept: number;
  dropped: number;
  preferences: string[];
  tasks: string[];
};

const DEFAULT_BUDGET = 10_000;
const SECRET_RE = /(api[_-]?key|token|password|secret|bearer\s+[a-z0-9._\-]+|sk-[a-z0-9]{16,})/i;

export function classifyMemoryScope(item: MemoryConsolidatorItem): MemoryConsolidatorItem["scope"] {
  if (item.scope) return item.scope;
  const blob = `${item.key} ${item.title} ${(item.tags ?? []).join(" ")}`.toLowerCase();
  if (blob.includes("preference") || blob.includes("stance") || /user[_-]?pref/.test(blob)) {
    return "preference";
  }
  if (blob.startsWith("study/") || blob.includes("study")) return "study";
  if (blob.startsWith("policy/") || blob.includes("policy")) return "policy";
  if (blob.startsWith("rule/") || blob.includes("task") || blob.startsWith("class/")) return "task";
  return "other";
}

export function redactMemorySecrets(text: string): string {
  return text
    .replace(SECRET_RE, "[redacted]")
    .replace(/https?:\/\/[^\s]+@(?:[^\s]+)/gi, "[redacted-url]")
    .trim();
}

/**
 * Build a compact summary for injection at session start.
 * Preferences first; recent task pointers next; drop duplicates and unsupported fluff.
 */
export function consolidateMemories(
  items: MemoryConsolidatorItem[],
  opts?: { budgetBytes?: number; now?: string },
): ConsolidatedMemory {
  const budget = opts?.budgetBytes ?? DEFAULT_BUDGET;
  const ranked = [...items]
    .map((item) => ({ ...item, scope: classifyMemoryScope(item) }))
    .sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  const preferences: string[] = [];
  const tasks: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const item of ranked) {
    const line = formatItemLine(item);
    if (!line) {
      dropped += 1;
      continue;
    }
    const fingerprint = line.toLowerCase().slice(0, 160);
    if (seen.has(fingerprint)) {
      dropped += 1;
      continue;
    }
    seen.add(fingerprint);
    if (item.scope === "preference") preferences.push(line);
    else tasks.push(line);
  }

  const parts = [
    "v1",
    "## User preferences",
    preferences.length ? preferences.map((row) => `- ${row}`).join("\n") : "- (none)",
    "## Task memory",
    tasks.length ? tasks.map((row) => `- ${row}`).join("\n") : "- (none)",
  ];
  let summary = parts.join("\n");
  let kept = preferences.length + tasks.length;

  while (byteLen(summary) > budget && (preferences.length || tasks.length)) {
    if (tasks.length) {
      tasks.pop();
      dropped += 1;
    } else {
      preferences.pop();
      dropped += 1;
    }
    kept = preferences.length + tasks.length;
    summary = [
      "v1",
      "## User preferences",
      preferences.length ? preferences.map((row) => `- ${row}`).join("\n") : "- (none)",
      "## Task memory",
      tasks.length ? tasks.map((row) => `- ${row}`).join("\n") : "- (none)",
    ].join("\n");
  }

  return {
    summary: summary.slice(0, budget),
    bytes: byteLen(summary),
    kept,
    dropped,
    preferences,
    tasks,
  };
}

function formatItemLine(item: MemoryConsolidatorItem): string {
  const title = redactMemorySecrets(item.title || item.key).slice(0, 120);
  const body = redactMemorySecrets(item.body).replace(/\s+/g, " ").slice(0, 180);
  if (!title && !body) return "";
  if (/invent|guess|probably|might be/i.test(body) && body.length < 40) return "";
  const scope = item.scope ?? "other";
  const when = item.updatedAt ? ` (${item.updatedAt.slice(0, 10)})` : "";
  return `${scope}:${title}${when}${body ? ` — ${body}` : ""}`.trim();
}

function scopeRank(scope: MemoryConsolidatorItem["scope"]): number {
  switch (scope) {
    case "preference":
      return 0;
    case "policy":
      return 1;
    case "study":
      return 2;
    case "task":
      return 3;
    default:
      return 4;
  }
}

function byteLen(text: string): number {
  return new TextEncoder().encode(text).length;
}
