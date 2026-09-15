/**
 * Cortical plasticity around an immutable brainstem (kernel).
 *
 * Law: a synapse strengthens only when recall changed the outcome;
 * unused weight decays; conflicts resolve by utility; structure (kernel)
 * changes only via human release.
 */

import type { SkillBodyRecord, SkillEnv, SkillStatus } from "../context/bodyStability.ts";

export type { SkillEnv };
export const PLASTIC_SLEEP_IDLE_MS = 20 * 60_000;
export const PLASTIC_SLEEP_COOLDOWN_MS = 45 * 60_000;

/** Days without use before verified skills start decaying hard. */
export const UNUSED_DECAY_DAYS = 30;
/** Quarantine with negative utility past this age → archive. */
export const QUARANTINE_ARCHIVE_DAYS = 7;

export type SynapseKind = "rule" | "skill";

export type SynapseStatus = "active" | "archived";

/** Sidecar plasticity for rules (skills carry fields on SkillBodyRecord). */
export type SynapseRecord = {
  kind: SynapseKind;
  ref: string;
  strength: number;
  recalls: number;
  uses: number;
  helps: number;
  hurts: number;
  lastRecalledAt?: string;
  lastUsedAt?: string;
  status: SynapseStatus;
  updatedAt: string;
};

export type ReconsolidationInput = {
  recalled: boolean;
  used: boolean;
  outcomeOk: boolean;
  now?: string;
};

export type PlasticWritePressure = {
  /** 0..1 — high after repeated gaps / frustration. */
  pressure: number;
  reason: string;
};

export type SleepAction =
  | { op: "archive"; name: string; reason: string }
  | { op: "deprecate"; name: string; reason: string }
  | { op: "demote"; name: string; to: SkillStatus; reason: string }
  | { op: "keep"; name: string };

export type DuelResult = {
  winner: string;
  loser: string;
  reason: string;
};

export function synapseKey(kind: SynapseKind, ref: string): string {
  return `plasticity/${kind}/${ref.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 120)}`;
}

export function parseSynapse(body: string, kind: SynapseKind, ref: string): SynapseRecord {
  try {
    const parsed = JSON.parse(body) as SynapseRecord;
    if (parsed?.ref && parsed.kind) return normalizeSynapse(parsed);
  } catch {
    /* fall through */
  }
  return emptySynapse(kind, ref);
}

export function emptySynapse(kind: SynapseKind, ref: string, now = new Date().toISOString()): SynapseRecord {
  return {
    kind,
    ref,
    strength: 0.4,
    recalls: 0,
    uses: 0,
    helps: 0,
    hurts: 0,
    status: "active",
    updatedAt: now,
  };
}

function normalizeSynapse(rec: SynapseRecord): SynapseRecord {
  return {
    ...emptySynapse(rec.kind, rec.ref, rec.updatedAt),
    ...rec,
    strength: clamp01(rec.strength ?? 0.4),
    recalls: Math.max(0, rec.recalls ?? 0),
    uses: Math.max(0, rec.uses ?? 0),
    helps: Math.max(0, rec.helps ?? 0),
    hurts: Math.max(0, rec.hurts ?? 0),
    status: rec.status === "archived" ? "archived" : "active",
  };
}

export function formatSynapse(rec: SynapseRecord): string {
  return JSON.stringify(normalizeSynapse(rec), null, 2);
}

export function daysSince(iso: string | undefined, nowMs = Date.now()): number {
  if (!iso) return 999;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, (nowMs - t) / 86_400_000);
}

/**
 * Utility index — Hebbian proxy.
 * utility = strength + wins/transfers − fails − age penalty
 */
export function skillUtility(rec: SkillBodyRecord, nowMs = Date.now()): number {
  const age = daysSince(rec.lastUsedAt ?? rec.updatedAt, nowMs);
  const strength = rec.strength ?? 0.4;
  const fails = rec.fails ?? 0;
  return strength
    + 0.15 * (rec.wins ?? 0)
    + 0.35 * (rec.transfers ?? 0)
    - 0.25 * fails
    - age / UNUSED_DECAY_DAYS;
}

export function synapseUtility(rec: SynapseRecord, nowMs = Date.now()): number {
  const age = daysSince(rec.lastUsedAt ?? rec.updatedAt, nowMs);
  return rec.strength + 0.2 * rec.helps - 0.3 * rec.hurts - age / UNUSED_DECAY_DAYS;
}

export function shouldArchiveSkill(rec: SkillBodyRecord, nowMs = Date.now()): boolean {
  if (rec.status === "archived" || rec.status === "frozen") return false;
  const util = skillUtility(rec, nowMs);
  const age = daysSince(rec.lastUsedAt ?? rec.updatedAt, nowMs);
  if (rec.status === "quarantine" && util < 0 && age >= QUARANTINE_ARCHIVE_DAYS) return true;
  if (rec.status === "deprecated" && daysSince(rec.deprecatedAt ?? rec.updatedAt, nowMs) >= UNUSED_DECAY_DAYS) {
    return true;
  }
  if ((rec.status === "verified" || rec.status === "quarantine") && util < -1 && age >= UNUSED_DECAY_DAYS) {
    return true;
  }
  return false;
}

export function shouldDemoteVerified(rec: SkillBodyRecord, nowMs = Date.now()): boolean {
  if (rec.status !== "verified") return false;
  const age = daysSince(rec.lastUsedAt ?? rec.updatedAt, nowMs);
  return age >= UNUSED_DECAY_DAYS && (rec.transfers ?? 0) === 0 && skillUtility(rec, nowMs) < 0.2;
}

/** Rare unfreeze when frozen skill keeps hurting in a changed env / streak of fails. */
export function shouldUnfreeze(rec: SkillBodyRecord): boolean {
  if (rec.status !== "frozen") return false;
  return (rec.fails ?? 0) >= 3 && (rec.wins ?? 0) < (rec.fails ?? 0);
}

/**
 * Reconsolidation: recalling makes the trace labile.
 * hit+used+pass → strengthen; hit+used+fail → weaken; hit+ignored → slight weaken.
 */
export function reconsolidateSkill(
  rec: SkillBodyRecord,
  input: ReconsolidationInput,
): SkillBodyRecord {
  if (!input.recalled || rec.status === "archived") return rec;
  const now = input.now ?? new Date().toISOString();
  let strength = rec.strength ?? 0.4;
  let fails = rec.fails ?? 0;
  let wins = rec.wins;
  const next: SkillBodyRecord = {
    ...rec,
    lastRecalledAt: now,
    updatedAt: now,
  };
  if (input.used) {
    next.lastUsedAt = now;
    if (input.outcomeOk) {
      strength = clamp01(strength + 0.12);
      wins += 1;
    } else {
      strength = clamp01(strength - 0.18);
      fails += 1;
    }
  } else {
    strength = clamp01(strength - 0.04);
  }
  next.strength = strength;
  next.fails = fails;
  next.wins = wins;
  if (shouldUnfreeze(next)) {
    next.status = "verified";
    next.frozenAt = undefined;
  }
  return next;
}

export function reconsolidateSynapse(
  rec: SynapseRecord,
  input: ReconsolidationInput,
): SynapseRecord {
  if (!input.recalled || rec.status === "archived") return rec;
  const now = input.now ?? new Date().toISOString();
  let strength = rec.strength;
  const next: SynapseRecord = {
    ...rec,
    recalls: rec.recalls + 1,
    lastRecalledAt: now,
    updatedAt: now,
  };
  if (input.used) {
    next.uses += 1;
    next.lastUsedAt = now;
    if (input.outcomeOk) {
      strength = clamp01(strength + 0.12);
      next.helps += 1;
    } else {
      strength = clamp01(strength - 0.18);
      next.hurts += 1;
    }
  } else {
    strength = clamp01(strength - 0.05);
  }
  next.strength = strength;
  if (synapseUtility(next) < -0.5 && next.hurts >= 2) next.status = "archived";
  return next;
}

/** Metaplasticity: how eager the body is to write new lessons. */
export function plasticWritePressure(input: {
  frustration?: number;
  gapCount?: number;
  sameFailureCount?: number;
}): PlasticWritePressure {
  const frustration = Math.max(0, input.frustration ?? 0);
  const gaps = Math.max(0, input.gapCount ?? 0);
  const same = Math.max(0, input.sameFailureCount ?? 0);
  const raw = clamp01(frustration / 8 + gaps / 4 + same / 4);
  let reason = "calm — prefer episode_only";
  if (raw >= 0.7) reason = "high pressure — pin failures sooner";
  else if (raw >= 0.4) reason = "elevated — normal write gates";
  return { pressure: raw, reason };
}

export function captureHostEnv(
  platform: NodeJS.Platform = process.platform,
  versions: { node?: string } = process.versions,
): SkillEnv {
  return {
    os: platform,
    runtime: "node",
    runtimeVersion: versions.node,
    compat: "any",
  };
}

export function envMatches(skillEnv: SkillEnv | undefined, host: SkillEnv): boolean {
  if (!skillEnv || skillEnv.compat === "any" || !skillEnv.compat) return true;
  if (skillEnv.os && host.os && skillEnv.os !== host.os) return false;
  if (skillEnv.runtime && host.runtime && skillEnv.runtime !== host.runtime) return false;
  if (skillEnv.compat === "exact") {
    if (skillEnv.runtimeVersion && host.runtimeVersion && skillEnv.runtimeVersion !== host.runtimeVersion) {
      return false;
    }
  }
  if (skillEnv.libs && host.libs) {
    for (const [lib, ver] of Object.entries(skillEnv.libs)) {
      if (host.libs[lib] && host.libs[lib] !== ver) return false;
    }
  }
  return true;
}

/** Deterministic duel: higher utility wins; loser deprecated. */
export function resolveSkillDuel(a: SkillBodyRecord, b: SkillBodyRecord, nowMs = Date.now()): DuelResult {
  const ua = skillUtility(a, nowMs);
  const ub = skillUtility(b, nowMs);
  if (ua >= ub) {
    return { winner: a.name, loser: b.name, reason: `utility ${ua.toFixed(2)} ≥ ${ub.toFixed(2)}` };
  }
  return { winner: b.name, loser: a.name, reason: `utility ${ub.toFixed(2)} > ${ua.toFixed(2)}` };
}

export function findDuelPairs(recs: SkillBodyRecord[]): Array<[SkillBodyRecord, SkillBodyRecord]> {
  const active = recs.filter((r) =>
    r.status === "verified" || r.status === "frozen" || r.status === "quarantine");
  const byClass = new Map<string, SkillBodyRecord[]>();
  for (const rec of active) {
    const key = `${rec.bornFromClass}::${rec.bornFromMode}`;
    const list = byClass.get(key) ?? [];
    list.push(rec);
    byClass.set(key, list);
  }
  const pairs: Array<[SkillBodyRecord, SkillBodyRecord]> = [];
  for (const list of byClass.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => skillUtility(b) - skillUtility(a));
    pairs.push([sorted[0]!, sorted[1]!]);
  }
  return pairs;
}

/** Idle sleep: prune, demote, duel-deprecate. Pure — caller persists. */
export function planPlasticSleep(recs: SkillBodyRecord[], nowMs = Date.now()): {
  next: SkillBodyRecord[];
  actions: SleepAction[];
} {
  const nowIso = new Date(nowMs).toISOString();
  const byName = new Map(recs.map((r) => [r.name, { ...r }]));
  const actions: SleepAction[] = [];

  for (const pair of findDuelPairs([...byName.values()])) {
    const duel = resolveSkillDuel(pair[0], pair[1], nowMs);
    const loser = byName.get(duel.loser);
    if (loser && loser.status !== "archived" && loser.status !== "deprecated") {
      byName.set(duel.loser, {
        ...loser,
        status: "deprecated",
        deprecatedAt: nowIso,
        updatedAt: nowIso,
      });
      actions.push({ op: "deprecate", name: duel.loser, reason: `duel lost to ${duel.winner}: ${duel.reason}` });
    }
  }

  for (const rec of [...byName.values()]) {
    if (shouldArchiveSkill(rec, nowMs)) {
      byName.set(rec.name, {
        ...rec,
        status: "archived",
        archivedAt: nowIso,
        updatedAt: nowIso,
      });
      actions.push({ op: "archive", name: rec.name, reason: "utility/age prune" });
      continue;
    }
    if (shouldDemoteVerified(rec, nowMs)) {
      byName.set(rec.name, {
        ...rec,
        status: "quarantine",
        updatedAt: nowIso,
      });
      actions.push({ op: "demote", name: rec.name, to: "quarantine", reason: "unused verified demoted" });
      continue;
    }
    actions.push({ op: "keep", name: rec.name });
  }

  return { next: [...byName.values()], actions };
}

export function planSynapseSleep(synapses: SynapseRecord[], nowMs = Date.now()): SynapseRecord[] {
  const nowIso = new Date(nowMs).toISOString();
  return synapses.map((rec) => {
    if (rec.status === "archived") return rec;
    if (synapseUtility(rec, nowMs) < -0.5 || (daysSince(rec.lastUsedAt ?? rec.updatedAt, nowMs) >= UNUSED_DECAY_DAYS && rec.uses === 0)) {
      return { ...rec, status: "archived", updatedAt: nowIso };
    }
    // passive decay
    return {
      ...rec,
      strength: clamp01(rec.strength - 0.02),
      updatedAt: nowIso,
    };
  });
}

export function needsPlasticSleep(recs: SkillBodyRecord[], nowMs = Date.now()): boolean {
  if (recs.some((r) => shouldArchiveSkill(r, nowMs) || shouldDemoteVerified(r, nowMs))) return true;
  return findDuelPairs(recs).length > 0;
}

export function filterSkillsForRecall(
  recs: SkillBodyRecord[],
  host: SkillEnv,
  opts?: { minUtility?: number },
): SkillBodyRecord[] {
  const min = opts?.minUtility ?? -0.5;
  return recs.filter((rec) => {
    if (rec.status === "archived" || rec.status === "deprecated") return false;
    if (!envMatches(rec.env, host)) return false;
    return skillUtility(rec) >= min;
  });
}

export function extractRecalledSkillNames(bags: { skills: string[]; rules: string[] }): string[] {
  const names: string[] = [];
  for (const line of bags.skills) {
    const m = /\[skill:([^\]]+)\]|skill[\/:\s]+([a-z0-9._-]+)/i.exec(line);
    const name = m?.[1] ?? m?.[2];
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

export function extractRecalledRuleKeys(bags: { rules: string[] }): string[] {
  const keys: string[] = [];
  for (const line of bags.rules) {
    const m = /\[rule:([^\]]+)\]/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
