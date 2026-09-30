/**
 * Autonomy law: agenda is written rarely, raised in idle, proven as a self-run, else dropped.
 *
 * Gap (fail/backlog/capability/inner) → AgendaItem (ZPD-graded) → idle self_run.
 * Never invent open-world quests.
 */

export type AgendaStatus = "pending" | "running" | "done" | "dropped";

/** Zone of proximal development: 1=name the fail, 2=checklist, 3=executable fail/pass proof. */
export type ZpdLevel = 1 | 2 | 3;

export type AgendaGap = {
  failClass: string;
  hint: string;
  count: number;
  source: "backlog" | "episode" | "capability" | "inner";
  zpdLevel?: ZpdLevel;
};

export type AgendaItem = {
  id: string;
  goal: string;
  reason: string;
  failClass: string;
  status: AgendaStatus;
  createdAt: string;
  runId?: string;
  finishedAt?: string;
  zpdLevel?: ZpdLevel;
};

export const SELF_RUN_COOLDOWN_MS = 30 * 60_000;
export const AGENDA_MIN_GAP_COUNT = 2;
export const AGENDA_MAX_PENDING = 3;

export function agendaMemoryKey(agentId: string): string {
  return `agenda/${agentId}`;
}

export function parseAgenda(body: string): AgendaItem[] {
  try {
    const parsed = JSON.parse(body) as { items?: AgendaItem[] } | AgendaItem[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item?.id && item?.goal && item?.failClass);
  } catch {
    return [];
  }
}

export function formatAgenda(items: AgendaItem[]): string {
  return JSON.stringify({ items }, null, 2);
}

export function zpdLevelForGap(gap: AgendaGap): ZpdLevel {
  if (gap.zpdLevel === 1 || gap.zpdLevel === 2 || gap.zpdLevel === 3) return gap.zpdLevel;
  if (gap.count >= 5 || gap.source === "capability") return 3;
  if (gap.count >= 3) return 2;
  return 1;
}

export function gapsFromBacklogRows(
  rows: Array<{ klass: string; count: number; hint?: string }>,
): AgendaGap[] {
  return rows
    .filter((row) => row.klass && row.klass !== "general" && row.klass !== "aborted-unfinished")
    .filter((row) => row.count >= AGENDA_MIN_GAP_COUNT)
    .map((row) => ({
      failClass: row.klass,
      count: row.count,
      hint: row.hint?.trim() || `Repeated failure mode: ${row.klass}`,
      source: "backlog" as const,
      zpdLevel: zpdLevelForGap({
        failClass: row.klass,
        count: row.count,
        hint: "",
        source: "backlog",
      }),
    }));
}

export function gapsFromFailEpisodes(
  episodes: Array<{ failureMode?: string | null; nextHint?: string | null; outcome: string }>,
): AgendaGap[] {
  const byClass = new Map<string, AgendaGap>();
  for (const episode of episodes) {
    if (episode.outcome !== "fail") continue;
    const klass = (episode.failureMode || "").trim() || "general";
    if (klass === "general" || klass === "aborted-unfinished") continue;
    const prev = byClass.get(klass);
    const hint = (episode.nextHint || "").trim() || `Failure mode ${klass}`;
    if (prev) {
      prev.count += 1;
      if (hint.length > prev.hint.length) prev.hint = hint;
      prev.zpdLevel = zpdLevelForGap(prev);
    } else {
      const gap: AgendaGap = { failClass: klass, hint, count: 1, source: "episode" };
      gap.zpdLevel = zpdLevelForGap(gap);
      byClass.set(klass, gap);
    }
  }
  return [...byClass.values()].filter((gap) => gap.count >= AGENDA_MIN_GAP_COUNT);
}

/** Concrete, local, ZPD-graded drill — not an open-world quest. */
export function proposeAgendaItem(gap: AgendaGap, now = new Date().toISOString()): AgendaItem {
  const level = zpdLevelForGap(gap);
  const id = `drill-zpd${level}-${gap.failClass}-${now.slice(0, 10)}`;
  const goal = drillGoalForZpd(gap, level);
  return {
    id,
    goal,
    reason: `${gap.source}:${gap.failClass}×${gap.count}:zpd${level}`,
    failClass: gap.failClass,
    status: "pending",
    createdAt: now,
    zpdLevel: level,
  };
}

export function drillGoalForZpd(gap: AgendaGap, level: ZpdLevel): string {
  const hint = clip(gap.hint, 200);
  if (level === 1) {
    return [
      `Autonomy drill (ZPD-1) for \`${gap.failClass}\`.`,
      `Write \`recovery-${gap.failClass}.md\` with exactly two sections:`,
      `## What failed`,
      `## What to do instead`,
      `Base on this hint (do not invent tools or URLs): ${hint}`,
      `Keep under 40 lines. Do not edit the kernel.`,
    ].join(" ");
  }
  if (level === 2) {
    return [
      `Autonomy drill (ZPD-2) for \`${gap.failClass}\`.`,
      `1) Write \`recovery-${gap.failClass}.md\` with ## What failed / ## What to do instead / ## Checklist (3 concrete steps).`,
      `2) Write \`checklist-${gap.failClass}.txt\` listing those 3 steps one per line.`,
      `Hint: ${hint}`,
      `No kernel edits. No invented URLs.`,
    ].join(" ");
  }
  const proof = `proof-${gap.failClass.replace(/[^a-zA-Z0-9_-]+/g, "-")}.py`;
  return [
    `Autonomy drill (ZPD-3) for \`${gap.failClass}\`.`,
    `1) Write \`recovery-${gap.failClass}.md\` (## What failed / ## What to do instead / ## Checklist).`,
    `2) Write executable \`${proof}\` (Python, no network) with two phases:`,
    `   - FAIL: reproduce the old/wrong path for this failClass; print exactly \`ZPD_PROOF fail=1\` when that path errors.`,
    `   - PASS: apply the instead-path from recovery; print exactly \`ZPD_PROOF pass=1\` when it succeeds.`,
    `3) Run the script with the shell tool and keep both marker lines in the tool output.`,
    `Hint: ${hint}`,
    `Done only if both markers appear. Do not edit the kernel.`,
  ].join(" ");
}

export function mergeAgenda(
  existing: AgendaItem[],
  proposed: AgendaItem[],
  maxPending = AGENDA_MAX_PENDING,
): AgendaItem[] {
  const byClass = new Set(
    existing
      .filter((item) => item.status === "pending" || item.status === "running")
      .map((item) => item.failClass),
  );
  const next = [...existing];
  for (const item of proposed) {
    if (byClass.has(item.failClass)) continue;
    if (next.filter((row) => row.status === "pending").length >= maxPending) break;
    const recentDone = existing.find((row) =>
      row.failClass === item.failClass
      && row.status === "done"
      && row.finishedAt
      && Date.now() - Date.parse(row.finishedAt) < SELF_RUN_COOLDOWN_MS);
    if (recentDone) continue;
    next.push(item);
    byClass.add(item.failClass);
  }
  return next.slice(-40);
}

export function nextPending(items: AgendaItem[]): AgendaItem | null {
  return items.find((item) => item.status === "pending") ?? null;
}

export function markAgenda(
  items: AgendaItem[],
  id: string,
  patch: Partial<Pick<AgendaItem, "status" | "runId" | "finishedAt">>,
): AgendaItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** Learning progress 0..1 from recent done vs dropped drills. */
export function agendaLearningProgress(items: AgendaItem[]): number {
  const finished = items.filter((item) => item.status === "done" || item.status === "dropped");
  if (!finished.length) return 0.5;
  const done = finished.filter((item) => item.status === "done").length;
  return done / finished.length;
}

function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}
