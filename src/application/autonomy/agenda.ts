/**
 * Autonomy law: agenda is written rarely, raised in idle, proven as a self-run, else dropped.
 *
 * Gap (fail/backlog) → AgendaItem → idle self_run → episode/rule — never invent open-world quests.
 */

export type AgendaStatus = "pending" | "running" | "done" | "dropped";

export type AgendaGap = {
  failClass: string;
  hint: string;
  count: number;
  source: "backlog" | "episode";
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
    } else {
      byClass.set(klass, { failClass: klass, hint, count: 1, source: "episode" });
    }
  }
  return [...byClass.values()].filter((gap) => gap.count >= AGENDA_MIN_GAP_COUNT);
}

/** Concrete, local, verifiable drill — not an open-world quest. */
export function proposeAgendaItem(gap: AgendaGap, now = new Date().toISOString()): AgendaItem {
  const id = `drill-${gap.failClass}-${now.slice(0, 10)}`;
  const goal = [
    `Autonomy drill for failure mode \`${gap.failClass}\`.`,
    `Write \`recovery-${gap.failClass}.md\` with exactly two sections:`,
    `## What failed`,
    `## What to do instead`,
    `Base the content on this hint (do not invent tools or URLs): ${clip(gap.hint, 220)}`,
    `Keep the file under 40 lines. Do not edit the kernel.`,
  ].join(" ");
  return {
    id,
    goal,
    reason: `${gap.source}:${gap.failClass}×${gap.count}`,
    failClass: gap.failClass,
    status: "pending",
    createdAt: now,
  };
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
    // Skip if recently done for same class.
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

function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}
