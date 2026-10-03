/**
 * Read-only psyche evolution snapshot for the web dashboard.
 * Aggregates body state — no new write paths.
 */

import type { AgendaItem } from "../autonomy/agenda.ts";
import type { SkillBodyRecord } from "../context/bodyStability.ts";

export type SkillBucket = {
  quarantine: string[];
  verified: string[];
  frozen: string[];
  other: string[];
};

export type PsycheEvolution = {
  shadowCount: number;
  lightCount: number;
  skills: SkillBucket & {
    quarantineCount: number;
    verifiedCount: number;
    frozenCount: number;
  };
  frustration: number | null;
  frustrationSource: "episode" | "transcript" | "none";
  lastDreamAt: string | null;
  lastDreamSummary: string | null;
  agenda: {
    pending: AgendaItem[];
    running: AgendaItem[];
    recentDone: AgendaItem[];
    nextGoal: string | null;
  };
  designSealed: boolean;
  updatedAt: string;
};

export function bucketSkills(recs: SkillBodyRecord[]): SkillBucket {
  const quarantine: string[] = [];
  const verified: string[] = [];
  const frozen: string[] = [];
  const other: string[] = [];
  for (const rec of recs) {
    if (rec.status === "quarantine") quarantine.push(rec.name);
    else if (rec.status === "verified") verified.push(rec.name);
    else if (rec.status === "frozen") frozen.push(rec.name);
    else other.push(rec.name);
  }
  return { quarantine, verified, frozen, other };
}

export function parseFrustrationFromMarkers(markers: string[] | undefined): number | null {
  if (!markers?.length) return null;
  for (const marker of markers) {
    const m = /^frustration:(\d+(?:\.\d+)?)$/i.exec(marker.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseFrustrationFromTranscript(
  lines: Array<{ kind: string; text: string }>,
): number | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const item = lines[i];
    if (!item || item.kind !== "system") continue;
    const m = /frustration(?:_score)?:\s*(\d+(?:\.\d+)?)/i.exec(item.text);
    if (m) return Number(m[1]);
  }
  return null;
}

export function summarizeDreamNote(body: string, updatedAt?: string): { at: string | null; summary: string | null } {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return { at: updatedAt ?? null, summary: null };
  return {
    at: updatedAt ?? null,
    summary: text.length <= 220 ? text : `${text.slice(0, 219)}…`,
  };
}

export function buildPsycheEvolution(input: {
  shadow: string[];
  light: string[];
  skills: SkillBodyRecord[];
  agenda: AgendaItem[];
  designSealed: boolean;
  frustration: number | null;
  frustrationSource: PsycheEvolution["frustrationSource"];
  dreamBody?: string;
  dreamUpdatedAt?: string;
  now?: string;
}): PsycheEvolution {
  const buckets = bucketSkills(input.skills);
  const pending = input.agenda.filter((item) => item.status === "pending");
  const running = input.agenda.filter((item) => item.status === "running");
  const recentDone = input.agenda
    .filter((item) => item.status === "done" || item.status === "dropped")
    .slice(-5)
    .reverse();
  const dream = summarizeDreamNote(input.dreamBody ?? "", input.dreamUpdatedAt);
  return {
    shadowCount: input.shadow.length,
    lightCount: input.light.length,
    skills: {
      ...buckets,
      quarantineCount: buckets.quarantine.length,
      verifiedCount: buckets.verified.length,
      frozenCount: buckets.frozen.length,
    },
    frustration: input.frustration,
    frustrationSource: input.frustrationSource,
    lastDreamAt: dream.at,
    lastDreamSummary: dream.summary,
    agenda: {
      pending,
      running,
      recentDone,
      nextGoal: running[0]?.goal ?? pending[0]?.goal ?? null,
    },
    designSealed: input.designSealed,
    updatedAt: input.now ?? new Date().toISOString(),
  };
}
