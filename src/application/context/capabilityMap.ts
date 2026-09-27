/**
 * Capability map — honest self-model of what the body can / cannot do.
 * Feeds agenda drills (weak/decay) without open-world quests.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";
import type { AgendaGap } from "../autonomy/agenda.ts";

export type CapabilityBand = "strong" | "ok" | "weak" | "decay" | "unknown";

export type CapabilityEntry = {
  key: string;
  kind: "skill" | "failClass";
  band: CapabilityBand;
  score: number;
  wins: number;
  fails: number;
  strength: number;
  ageDays: number;
  hint: string;
};

export function capabilityMapKey(agentId: string): string {
  return `capability/${agentId}`;
}

export function daysSinceIso(iso: string | undefined, nowMs = Date.now()): number {
  if (!iso) return 999;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, (nowMs - t) / 86_400_000);
}

export function scoreSkillCapability(rec: SkillBodyRecord, nowMs = Date.now()): CapabilityEntry {
  const wins = rec.wins ?? 0;
  const fails = rec.fails ?? 0;
  const strength = rec.strength ?? 0.4;
  const ageDays = daysSinceIso(rec.lastUsedAt ?? rec.updatedAt, nowMs);
  const net = wins - fails + strength * 2 - Math.min(ageDays, 60) / 30;
  let band: CapabilityBand = "unknown";
  if (rec.status === "archived" || rec.status === "deprecated") band = "decay";
  else if (ageDays >= 30 && wins + fails > 0 && (rec.lastUsedAt ? ageDays >= 30 : ageDays >= 45)) {
    band = "decay";
  } else if (fails >= wins + 2 || (fails >= 2 && strength < 0.35)) band = "weak";
  else if (wins >= 3 && fails <= 1 && strength >= 0.55) band = "strong";
  else if (wins + fails > 0) band = "ok";
  return {
    key: rec.name,
    kind: "skill",
    band,
    score: net,
    wins,
    fails,
    strength,
    ageDays,
    hint: `${rec.status} · ${rec.bornFromMode || rec.bornFromClass || "general"}`,
  };
}

export function scoreFailClassCapability(input: {
  klass: string;
  count: number;
  hint?: string;
}): CapabilityEntry {
  const count = input.count;
  const band: CapabilityBand = count >= 4 ? "weak" : count >= 2 ? "weak" : "unknown";
  return {
    key: input.klass,
    kind: "failClass",
    band,
    score: -count,
    wins: 0,
    fails: count,
    strength: 0,
    ageDays: 0,
    hint: input.hint?.trim() || `Repeated failure mode: ${input.klass}`,
  };
}

export function buildCapabilityMap(input: {
  skills: SkillBodyRecord[];
  failClasses?: Array<{ klass: string; count: number; hint?: string }>;
  nowMs?: number;
}): CapabilityEntry[] {
  const now = input.nowMs ?? Date.now();
  const skills = input.skills.map((rec) => scoreSkillCapability(rec, now));
  const fails = (input.failClasses ?? [])
    .filter((row) => row.klass && row.klass !== "general" && row.klass !== "aborted-unfinished")
    .map(scoreFailClassCapability);
  return [...skills, ...fails].sort((a, b) => a.score - b.score);
}

/** Gaps for agenda: weak/decay entries that need deliberate practice. */
export function gapsFromCapabilityMap(entries: CapabilityEntry[]): AgendaGap[] {
  return entries
    .filter((entry) => entry.band === "weak" || entry.band === "decay")
    .filter((entry) => entry.kind === "failClass" || entry.fails + entry.wins >= 1)
    .slice(0, 6)
    .map((entry) => ({
      failClass: entry.kind === "failClass" ? entry.key : slugFailFromSkill(entry),
      hint: entry.kind === "skill"
        ? `Capability ${entry.band}: skill ${entry.key} (${entry.hint}). Rehearse the recovery path.`
        : entry.hint,
      count: Math.max(2, entry.fails || 2),
      source: "capability" as const,
      zpdLevel: entry.band === "decay" || entry.fails >= 4 ? 3 as const : entry.fails >= 3 ? 2 as const : 1 as const,
    }));
}

export function formatCapabilityMap(entries: CapabilityEntry[]): string {
  return JSON.stringify({ at: new Date().toISOString(), entries }, null, 2);
}

export function parseCapabilityMap(body: string): CapabilityEntry[] {
  try {
    const parsed = JSON.parse(body) as { entries?: CapabilityEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function formatCapabilityHint(entries: CapabilityEntry[]): string {
  const weak = entries.filter((e) => e.band === "weak" || e.band === "decay").slice(0, 4);
  const strong = entries.filter((e) => e.band === "strong").slice(0, 3);
  const bits = [
    weak.length
      ? `Self-model weak/decay: ${weak.map((e) => `${e.key}(${e.band})`).join(", ")}`
      : "",
    strong.length
      ? `Self-model strong: ${strong.map((e) => e.key).join(", ")}`
      : "",
  ].filter(Boolean);
  return bits.join(". ");
}

function slugFailFromSkill(entry: CapabilityEntry): string {
  const fromHint = entry.hint.match(/·\s*([a-z0-9-]+)/i)?.[1];
  if (fromHint && fromHint !== "general") return fromHint;
  return entry.key.replace(/^learned-/, "") || "general";
}
