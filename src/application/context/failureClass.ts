import type { FailureKind } from "../../domain/run/Review.ts";

export type BacklogRow = {
  klass: string;
  count: number;
  lastAt: string;
};

export function failureClass(input: {
  kind?: FailureKind;
  aborted?: boolean;
}): string {
  if (input.aborted) return "aborted-unfinished";
  return input.kind ?? "general";
}

export function learnedSkillDraft(klass: string, path: {
  failedFamily?: string;
  recoveredBy?: string;
  line?: string;
}): { name: string; body: string } | null {
  if (klass === "general" || klass === "aborted-unfinished") return null;
  const failed = (path.failedFamily ?? "").trim().toLowerCase().slice(0, 40);
  const recovered = (path.recoveredBy ?? "").trim().toLowerCase().slice(0, 40);
  const line = [
    failed && recovered && recovered !== failed ? `after ${failed} failed, ${recovered} delivered` : "",
    recovered && !failed ? `${recovered} delivered` : "",
    path.line?.replace(/\s+/g, " ").trim().slice(0, 180) ?? "",
  ].find((item) => item) ?? "";
  if (!line) return null;
  const name = `learned-${klass}`;
  return {
    name,
    body: [
      "---",
      `name: ${name}`,
      `description: Scheme that recovered a ${klass} miss.`,
      "origin: learned",
      "verified: true",
      "---",
      "",
      line,
      "Do not repeat the failed family. Do not edit the kernel.",
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
