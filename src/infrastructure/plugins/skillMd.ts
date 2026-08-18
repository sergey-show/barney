const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function toPluginName(value: string): string | null {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
  return NAME.test(slug) ? slug : null;
}

export type SkillMd = {
  name?: string;
  description?: string;
  version?: string;
  fields: Record<string, string>;
  metadata: Record<string, string>;
  body: string;
  hasFrontmatter: boolean;
};

export function parseSkillMd(text: string): SkillMd {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) return { fields: {}, metadata: {}, body: text.replace(/^\uFEFF/, "").trim(), hasFrontmatter: false };
  const { fields, metadata } = parseFrontmatter(match[1] ?? "");
  const body = (match[2] ?? "").trim();
  const name = toPluginName(fields.name ?? "") ?? undefined;
  const description = (fields.description ?? "").trim() || undefined;
  const version = (metadata.version || fields.version || "").trim() || undefined;
  return { name, description, version, fields, metadata, body, hasFrontmatter: true };
}

export function applySkillPlaceholders(text: string, dir: string): string {
  return text.replaceAll("{baseDir}", dir).replaceAll("${CLAUDE_PLUGIN_ROOT}", dir);
}

function parseFrontmatter(block: string): { fields: Record<string, string>; metadata: Record<string, string> } {
  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1] ?? "";
    const raw = match[2] ?? "";
    if (key === "metadata" && (!raw || raw === "|" || raw === ">" || raw === "{}")) {
      const nested = readIndented(lines, i + 1);
      i = nested.next;
      Object.assign(metadata, parseNestedMap(nested.text || raw));
      continue;
    }
    if (raw === "|" || raw === ">" || raw === "") {
      const nested = readIndented(lines, i + 1);
      i = nested.next;
      const value = nested.text.trim();
      if (key === "metadata") Object.assign(metadata, parseNestedMap(value));
      else fields[key] = unquote(value);
      continue;
    }
    fields[key] = unquote(raw);
    i += 1;
  }
  if (fields.metadata && !Object.keys(metadata).length) {
    Object.assign(metadata, parseNestedMap(fields.metadata));
    delete fields.metadata;
  }
  return { fields, metadata };
}

function readIndented(lines: string[], start: number): { text: string; next: number } {
  const chunks: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      chunks.push("");
      i += 1;
      continue;
    }
    if (!/^[ \t]/.test(line)) break;
    chunks.push(line.replace(/^[ \t]{1,2}/, "").replace(/^\t/, ""));
    i += 1;
  }
  return { text: chunks.join("\n").trim(), next: i };
}

function parseNestedMap(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
      }
    } catch {
      /* fall through */
    }
  }
  const map: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_/-]*)\s*:\s*(.+)$/);
    if (match) map[match[1] ?? ""] = unquote(match[2] ?? "");
  }
  return map;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return quoted ? (quoted[2] ?? "") : trimmed;
}
