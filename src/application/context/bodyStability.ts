/**
 * Body stability: quarantine → verified → frozen.
 * Frozen skills are not rewritten by formation/recovery experiments.
 */

export type SkillStatus = "quarantine" | "verified" | "frozen";

export type SkillBodyRecord = {
  name: string;
  status: SkillStatus;
  wins: number;
  transfers: number;
  bornFromClass: string;
  bornFromMode: string;
  updatedAt: string;
  frozenAt?: string;
};

export function skillBodyKey(name: string): string {
  return `body/skill/${name}`;
}

export function parseSkillBody(body: string, name: string): SkillBodyRecord {
  try {
    const parsed = JSON.parse(body) as SkillBodyRecord;
    if (parsed?.name && parsed.status) return parsed;
  } catch {
    /* fall through */
  }
  return admitNewSkill(name, "general", "general");
}

export function admitNewSkill(
  name: string,
  bornFromClass: string,
  bornFromMode: string,
): SkillBodyRecord {
  return {
    name,
    status: "quarantine",
    wins: 0,
    transfers: 0,
    bornFromClass: bornFromClass || "general",
    bornFromMode: bornFromMode || "general",
    updatedAt: new Date().toISOString(),
  };
}

/** Quarantine skills must not be rewritten; frozen never rewritten. */
export function canRewriteSkill(rec: SkillBodyRecord | null | undefined): boolean {
  if (!rec) return true;
  return rec.status === "quarantine" && rec.wins === 0 && rec.transfers === 0;
}

export function recordSkillOutcome(
  rec: SkillBodyRecord,
  input: { success: boolean; transfer: boolean },
): SkillBodyRecord {
  if (!input.success) {
    return { ...rec, updatedAt: new Date().toISOString() };
  }
  const next: SkillBodyRecord = {
    ...rec,
    wins: rec.wins + 1,
    transfers: rec.transfers + (input.transfer ? 1 : 0),
    updatedAt: new Date().toISOString(),
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
