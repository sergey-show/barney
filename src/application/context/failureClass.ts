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
  const text = `${input.missing ?? ""} ${input.summary ?? ""}`;
  if (/DETECTED_SECRET|live value/i.test(text)) return "masked-deliverable";
  if (/no successful run|not yet run/i.test(text)) return "unrun-program";
  if (/captured a tool error|last write captured/i.test(text)) return "captured-error";
  if (/no write of|not yet written/i.test(text)) return "missing-artifact";
  return "general";
}

export function learnedSkillDraft(klass: string, lesson: string): { name: string; body: string } | null {
  if (klass === "general" || klass === "aborted-unfinished") return null;
  const line = lesson.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!line) return null;
  const name = `learned-${klass}`;
  return {
    name,
    body: [
      "---",
      `name: ${name}`,
      `description: Scheme learned from a repeated ${klass} miss.`,
      "origin: learned",
      "---",
      "",
      line,
      "Change path; do not repeat the failed call. Do not edit the kernel.",
      "",
    ].join("\n"),
  };
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
