/**
 * Run-local progress signal: feeds wanting ≠ liking, persist nudges, and review pins.
 * Score rises when missing artifacts fall, mutates/probes appear, or failure mode changes.
 */

export type ProgressDelta = "improved" | "flat" | "regressed";

export type ProgressSnapshot = {
  score: number;
  missingArtifacts: number;
  mutates: number;
  probes: number;
  inspections: number;
  saturatedFamilies: number;
  sameFailureCount: number;
  boardFacts: number;
  delta: ProgressDelta;
  /** New write/probe/family recovery since previous snapshot — allow another approach. */
  secondWind: boolean;
  taskKind: "delivery" | "research" | "mixed";
  pinLine: string;
};

export type ProgressInput = {
  latest: string;
  evidence: string;
  missingArtifacts?: string[];
  saturatedFamilies?: number;
  sameFailureCount?: number;
  boardFacts?: number;
  prev?: ProgressSnapshot | null;
  /** True when a new research note or recovered family landed this approach. */
  newSignal?: boolean;
};

export function measureProgress(input: ProgressInput): ProgressSnapshot {
  const missing = input.missingArtifacts?.length
    ?? countMissingArtifacts(input.latest, input.evidence);
  const mutates = countMutates(input.evidence);
  const probes = countProbes(input.evidence);
  const inspections = countInspections(input.evidence);
  const saturated = input.saturatedFamilies ?? 0;
  const sameFail = input.sameFailureCount ?? 0;
  const facts = input.boardFacts ?? 0;
  const taskKind = classifyTask(input.latest);

  let score = 40;
  score += Math.min(mutates, 6) * 8;
  score += Math.min(probes, 4) * 4;
  score += Math.min(facts, 4) * 2;
  score -= Math.min(missing, 8) * 10;
  score -= Math.min(saturated, 4) * 5;
  score -= Math.min(sameFail, 3) * 4;
  if (inspections > 0 && mutates === 0 && taskKind === "delivery") score -= 12;
  score = clamp(score, 0, 100);

  const prev = input.prev ?? null;
  const delta = compareProgress(prev, {
    score,
    missingArtifacts: missing,
    mutates,
    probes,
  });
  const secondWind = Boolean(input.newSignal)
    || Boolean(prev && (
      mutates > prev.mutates
      || probes > prev.probes
      || missing < prev.missingArtifacts
    ));

  const pinLine = [
    `Progress ${score}/100 (${delta}${secondWind ? ", second wind" : ""})`,
    missing ? `missing files: ${missing}` : "no pinned file gaps",
    `mutates=${mutates} probes=${probes} inspections=${inspections}`,
  ].join("; ");

  return {
    score,
    missingArtifacts: missing,
    mutates,
    probes,
    inspections,
    saturatedFamilies: saturated,
    sameFailureCount: sameFail,
    boardFacts: facts,
    delta,
    secondWind,
    taskKind,
    pinLine,
  };
}

export function compareProgress(
  prev: ProgressSnapshot | null | undefined,
  next: { score: number; missingArtifacts: number; mutates: number; probes: number },
): ProgressDelta {
  if (!prev) return "flat";
  if (next.missingArtifacts < prev.missingArtifacts) return "improved";
  if (next.mutates > prev.mutates || next.probes > prev.probes) return "improved";
  if (next.score >= prev.score + 8) return "improved";
  if (next.missingArtifacts > prev.missingArtifacts) return "regressed";
  if (next.score <= prev.score - 8) return "regressed";
  return "flat";
}

/** Delivery goals that expect disk/config mutation vs research/lookup. */
export function classifyTask(latest: string): "delivery" | "research" | "mixed" {
  const delivery = /\b(write|create|save|fix|replace|sanitize|edit|patch|merge|implement|generate|install|configure)\b/i.test(latest)
    || /<your-[a-z0-9-]+>/i.test(latest);
  const research = /\b(find|search|look\s*up|explain|what is|how does|research|docs?\b|документац)\b/i.test(latest);
  if (delivery && research) return "mixed";
  if (delivery) return "delivery";
  if (research) return "research";
  return "mixed";
}

function countMissingArtifacts(latest: string, evidence: string): number {
  // Lazy import avoidance: duplicate light path scan for requested `paths`.
  const paths: string[] = [];
  for (const match of latest.matchAll(/`(\/?[\w./-]+\.[A-Za-z0-9.]+)`/g)) {
    const path = (match[1] ?? "").replaceAll("\\", "/");
    if (path.includes(".")) paths.push(path);
  }
  if (!paths.length) return 0;
  return paths.filter((path) => !evidenceWrotePath(evidence, path)).length;
}

function evidenceWrotePath(evidence: string, path: string): boolean {
  const base = path.split("/").filter(Boolean).at(-1) ?? path;
  return new RegExp(
    `(?:fs_write|fs_edit|wrote)\\b[^\\n]*${escapeReg(base)}|` +
      `(?:tee|\\>|\\>\\>)\\s*[^\\n]*${escapeReg(base)}`,
    "i",
  ).test(evidence);
}

function countMutates(evidence: string): number {
  let n = 0;
  for (const block of evidence.split(/\n(?=(?:fs_|shell |browser_))/)) {
    const head = block.split("\n")[0] ?? "";
    if (/^fs_(?:write|edit|append) /.test(head) && !/^error:/im.test(block)) n += 1;
    else if (/^shell /.test(head) && /\bsed\b/i.test(head) && /-i\b/.test(head) && /^exit 0\b/m.test(block)) n += 1;
  }
  return n;
}

function countProbes(evidence: string): number {
  let n = 0;
  for (const block of evidence.split(/\n(?=(?:fs_|shell |browser_))/)) {
    const head = block.split("\n")[0] ?? "";
    if (/^fs_read /.test(head)) n += 1;
    else if (/^shell /.test(head) && /\b(?:grep|cat|head|tail|wc|test|python|node)\b/i.test(head)) n += 1;
  }
  return n;
}

function countInspections(evidence: string): number {
  let n = 0;
  for (const block of evidence.split(/\n(?=(?:fs_|shell |browser_))/)) {
    const head = block.split("\n")[0] ?? "";
    if (/^fs_(?:search|list|read) /.test(head)) n += 1;
    else if (/^shell /.test(head) && /\b(?:grep|find|rg|git\s+status|git\s+log)\b/i.test(head)) n += 1;
  }
  return n;
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
