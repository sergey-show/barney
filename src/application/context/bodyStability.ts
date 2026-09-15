/**
 * Body stability: quarantine → verified → frozen (+ deprecated / archived).
 * Frozen skills are not rewritten by formation/recovery experiments.
 * Plasticity fields (strength, fails, env) follow cortical Hebbian rules.
 */

export type SkillStatus = "quarantine" | "verified" | "frozen" | "deprecated" | "archived";

export type SkillEnv = {
  os?: string;
  runtime?: string;
  runtimeVersion?: string;
  libs?: Record<string, string>;
  arch?: string;
  compat?: "exact" | "range" | "any";
};

export type SkillBodyRecord = {
  name: string;
  status: SkillStatus;
  wins: number;
  transfers: number;
  fails: number;
  /** Synaptic weight 0..1 — reconsolidation moves this. */
  strength: number;
  bornFromClass: string;
  bornFromMode: string;
  updatedAt: string;
  lastUsedAt?: string;
  lastRecalledAt?: string;
  frozenAt?: string;
  deprecatedAt?: string;
  archivedAt?: string;
  env?: SkillEnv;
  /** Compressed tool-family sequence that recovered (procedural trace). */
  procedure?: string[];
};

export function skillBodyKey(name: string): string {
  return `body/skill/${name}`;
}

export function parseSkillBody(body: string, name: string): SkillBodyRecord {
  try {
    const parsed = JSON.parse(body) as SkillBodyRecord;
    if (parsed?.name && parsed.status) return normalizeSkillBody(parsed);
  } catch {
    /* fall through */
  }
  return admitNewSkill(name, "general", "general");
}

function normalizeSkillBody(rec: SkillBodyRecord): SkillBodyRecord {
  return {
    ...admitNewSkill(rec.name, rec.bornFromClass, rec.bornFromMode),
    ...rec,
    fails: Math.max(0, rec.fails ?? 0),
    strength: clamp01(rec.strength ?? 0.4),
    wins: Math.max(0, rec.wins ?? 0),
    transfers: Math.max(0, rec.transfers ?? 0),
  };
}

export function admitNewSkill(
  name: string,
  bornFromClass: string,
  bornFromMode: string,
  env?: SkillEnv,
): SkillBodyRecord {
  const now = new Date().toISOString();
  return {
    name,
    status: "quarantine",
    wins: 0,
    transfers: 0,
    fails: 0,
    strength: 0.4,
    bornFromClass: bornFromClass || "general",
    bornFromMode: bornFromMode || "general",
    updatedAt: now,
    lastUsedAt: now,
    env,
  };
}

/** Quarantine skills must not be rewritten; frozen never rewritten. */
export function canRewriteSkill(rec: SkillBodyRecord | null | undefined): boolean {
  if (!rec) return true;
  if (rec.status === "archived" || rec.status === "deprecated" || rec.status === "frozen") return false;
  return rec.status === "quarantine" && rec.wins === 0 && rec.transfers === 0;
}

export function recordSkillOutcome(
  rec: SkillBodyRecord,
  input: { success: boolean; transfer: boolean },
): SkillBodyRecord {
  const now = new Date().toISOString();
  if (!input.success) {
    return {
      ...rec,
      fails: (rec.fails ?? 0) + 1,
      strength: clamp01((rec.strength ?? 0.4) - 0.08),
      updatedAt: now,
    };
  }
  const next: SkillBodyRecord = {
    ...rec,
    wins: rec.wins + 1,
    transfers: rec.transfers + (input.transfer ? 1 : 0),
    strength: clamp01((rec.strength ?? 0.4) + 0.1),
    lastUsedAt: now,
    updatedAt: now,
  };
  if (next.status === "quarantine" && (next.wins >= 2 || next.transfers >= 1)) {
    next.status = "verified";
  }
  if (next.status === "verified" && (next.wins >= 3 || next.transfers >= 1)) {
    next.status = "frozen";
    next.frozenAt = next.updatedAt;
  }
  return next;
}

export function formatSkillBodyHint(recs: SkillBodyRecord[]): string {
  if (!recs.length) return "";
  const frozen = recs.filter((r) => r.status === "frozen").map((r) => r.name);
  const quarantine = recs.filter((r) => r.status === "quarantine").map((r) => r.name);
  const bits = [
    frozen.length ? `Frozen skills (stable): ${frozen.join(", ")}` : "",
    quarantine.length ? `Quarantine skills (probation): ${quarantine.join(", ")}` : "",
  ].filter(Boolean);
  return bits.join(". ");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
