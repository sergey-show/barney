export type BacklogRow = {
  klass: string;
  count: number;
  lastAt: string;
};

export function failureClass(input: {
  goal?: string;
  missing?: string;
  summary?: string;
  aborted?: boolean;
}): string {
  if (input.aborted) return "aborted-unfinished";
  return "general";
}

export function bumpBacklog(prev: BacklogRow | null, klass: string, now = new Date().toISOString()): BacklogRow {
  if (prev?.klass === klass) return { klass, count: prev.count + 1, lastAt: now };
  return { klass, count: 1, lastAt: now };
}

export function shouldCloseClass(row: BacklogRow): boolean {
  return row.count >= 2;
}

export { skillDraft } from "../skills/starterSkills.ts";

export function parseBacklog(body: string): BacklogRow | null {
  const klass = body.match(/^klass:\s*(.+)$/m)?.[1]?.trim();
  const count = Number(body.match(/^count:\s*(\d+)/m)?.[1] ?? 0);
  const lastAt = body.match(/^lastAt:\s*(.+)$/m)?.[1]?.trim() ?? "";
  if (!klass || !count) return null;
  return { klass, count, lastAt };
}

export function formatBacklog(row: BacklogRow): string {
  return [`klass: ${row.klass}`, `count: ${row.count}`, `lastAt: ${row.lastAt}`].join("\n");
}
