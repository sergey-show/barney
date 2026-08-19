export type ExperienceKind = "failed-as" | "learned" | "recovered-by";

export type MemoryShelf = "yours" | "learned" | "internal";

export type ExperienceEdge = {
  src: string;
  dst: string;
  kind: ExperienceKind;
  createdAt: string;
};

export type ExperienceNode = {
  id: string;
  kind: "class" | "rule" | "plugin" | "note";
  title: string;
  shelf: MemoryShelf;
};

export function classKey(klass: string): string {
  const slug = klass.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
  return `class/${slug || "general"}`;
}

export function pluginMemoryKey(name: string): string {
  return `plugin/${name}`;
}

export function nodeKindFromKey(key: string): ExperienceNode["kind"] {
  if (key.startsWith("class/")) return "class";
  if (key.startsWith("rule/")) return "rule";
  if (key.startsWith("plugin/") || key.startsWith("backlog/")) return "plugin";
  return "note";
}

export function titleFromKey(key: string): string {
  const tail = key.split("/").pop() ?? key;
  if (key.startsWith("class/")) return tail.replace(/-/g, " ");
  return tail;
}

export function memoryShelf(note: { key: string; tags: string[] }): MemoryShelf {
  if (isInternalKey(note.key)) return "internal";
  const tags = new Set(note.tags);
  if (["psyche", "board", "existence", "digest", "session", "plan"].some((tag) => tags.has(tag))) {
    return "internal";
  }
  if (
    keyLooksLearned(note.key)
    || ["rule", "fail", "experience", "learned", "plugin", "backlog", "research", "study"].some((tag) => tags.has(tag))
  ) {
    return "learned";
  }
  return "yours";
}

export function isInternalKey(key: string): boolean {
  return /^(samost|design|existence|tree|session|plan)\//.test(key);
}

function keyLooksLearned(key: string): boolean {
  return /^(rule|plugin|backlog|class|study|research)\//.test(key);
}
