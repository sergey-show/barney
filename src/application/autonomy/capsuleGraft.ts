/**
 * barney graft (P.3): quarantined cross-agent capsule transfer.
 *
 * A "graft" is a skill capsule authored by another Barney instance (or any
 * compatible agent) and imported into this agent's body. The roadmap names
 * this "barney graft": the capsule arrives with whatever status the source
 * claimed, but it enters this body in `quarantine` regardless — even if the
 * source swore it was `frozen`. Promotion to `verified`/`frozen` happens
 * only after a ZPD-3 local proof on *this* agent's environment, through the
 * existing skill_exam_path (bodyAdmission) + runAutonomyDrill pipeline.
 *
 * This module is pure (no I/O, no LLM). It:
 *   1. Parses an external capsule payload into a validated shape.
 *   2. Sanitizes the procedure: lifts hardcoded paths/URLs/UUIDs into
 *      binding slots (reuses skillReplayAdmit.liftBindings) so the capsule
 *      transfers across environments without leaking the source's literals.
 *   3. Forces `status: "quarantine"`, `bornFromMode: "graft"`, resets wins/
 *      transfers/fails/strength — the source's track record does not survive
 *      the border; only the procedure does.
 *   4. Admits only if structure + replay + domain checks pass. A capsule
 *      whose procedure is empty, bindings-only, or in a foreign domain
 *      (no overlap with this agent's taskClass) is rejected, not grafted.
 *
 * The actual memory write + ZPD-3 proof dispatch lives in Kernel; this module
 * only decides *what* to graft and *whether* it is admissible.
 */

import type { SkillBodyRecord, SkillStatus } from "../context/bodyStability.ts";
import {
  liftBindings,
  qualifyProcedureStructure,
  replayProcedure,
} from "../experience/skillReplayAdmit.ts";

/** External capsule payload — what a source agent exports. */
export type ExternalCapsule = {
  name: string;
  klass: string;
  procedure: string[];
  /** Source status (informational only — always enters quarantine on graft). */
  sourceStatus?: SkillStatus;
  /** Source track record (informational only — reset on graft). */
  sourceWins?: number;
  sourceTransfers?: number;
  sourceFails?: number;
  sourceStrength?: number;
  /** Optional skill-markdown body to write into SKILL.md. */
  skillMd?: string;
  /** Provenance: where the capsule came from. */
  sourceAgentId?: string;
  sourceEnv?: SkillBodyRecord["env"];
};

export type GraftDecision =
  | { admit: true; record: SkillBodyRecord; skillMd?: string; reason: string; bindingHits: string[] }
  | { admit: false; reason: string };

/**
 * Parse + sanitize + decide whether an external capsule may enter quarantine.
 * Never throws — malformed input is rejected with a reason.
 */
export function admitGraft(input: {
  capsule: ExternalCapsule;
  /** This agent's taskClass — used to reject foreign-domain capsules. */
  targetTaskClass: string;
}): GraftDecision {
  const { capsule, targetTaskClass } = input;

  // 1. Name + klass must be non-empty and sane.
  const name = (capsule.name ?? "").trim();
  const klass = (capsule.klass ?? "").trim();
  if (!name || name.length > 128) {
    return { admit: false, reason: "graft · invalid name" };
  }
  if (!klass) {
    return { admit: false, reason: "graft · missing klass" };
  }

  // 2. Structure check on the procedure.
  const structure = qualifyProcedureStructure(capsule.procedure);
  if (!structure.ok) {
    return { admit: false, reason: `graft · ${structure.reason}` };
  }

  // 3. Sanitize: lift hardcoded literals into binding slots.
  const lifted = liftBindings(capsule.procedure);
  const replay = replayProcedure(lifted.procedure);
  if (!replay.ok) {
    return { admit: false, reason: `graft · ${replay.reason}` };
  }

  // 4. Domain match: the capsule's klass must share at least one token with
  //    the target agent's taskClass — otherwise we'd graft a shell:openssl
  //    capsule into a python:parse agent and call it "transfer". One token
  //    of overlap is enough; the ZPD-3 proof will catch semantic drift.
  if (!domainOverlap(klass, targetTaskClass)) {
    return {
      admit: false,
      reason: `graft · domain mismatch: capsule klass "${klass}" shares no tokens with target taskClass "${targetTaskClass}"`,
    };
  }

  // 5. Build the quarantine record. Source track record is dropped — only
  //    the procedure crosses the border. bornFromMode marks the graft lineage
  //    so reconsolidation and the body ledger can tell grafted capsules from
  //    home-grown ones.
  const now = new Date().toISOString();
  const record: SkillBodyRecord = {
    name,
    status: "quarantine",
    wins: 0,
    transfers: 0,
    fails: 0,
    strength: 0.2, // start low; ZPD-3 proof + recall will raise it
    bornFromClass: klass,
    bornFromMode: "graft",
    updatedAt: now,
    lastUsedAt: now,
    env: capsule.sourceEnv, // carry env metadata so ZPD-3 proof can check compat
  };

  return {
    admit: true,
    record,
    skillMd: capsule.skillMd,
    reason: lifted.hits.length
      ? `graft · quarantine · lifted ${lifted.hits.join(",")}`
      : "graft · quarantine · no hardcoded literals",
    bindingHits: lifted.hits,
  };
}

const DOMAIN_SEP = /[^a-z0-9_-]+/i;

/** Token overlap between two domain strings (case-insensitive, len>2). */
export function domainOverlap(a: string, b: string): boolean {
  const toks = (s: string) =>
    new Set(s.toLowerCase().split(DOMAIN_SEP).filter((t) => t.length > 2));
  const aa = toks(a);
  const bb = toks(b);
  for (const t of aa) if (bb.has(t)) return true;
  return false;
}

/**
 * Format the graft memory note body for the quarantine entry.
 * Keeps the source provenance in the body (not in the record) so the ledger
 * can audit where capsules came from without polluting SkillBodyRecord.
 */
export function graftProvenanceNote(capsule: ExternalCapsule, decision: GraftDecision): string {
  const lines = [
    `graft: ${capsule.name}`,
    `sourceStatus: ${capsule.sourceStatus ?? "unknown"}`,
    `sourceAgentId: ${capsule.sourceAgentId ?? "unknown"}`,
    `sourceWins: ${capsule.sourceWins ?? 0}`,
    `sourceTransfers: ${capsule.sourceTransfers ?? 0}`,
    `sourceFails: ${capsule.sourceFails ?? 0}`,
    `sourceStrength: ${capsule.sourceStrength ?? 0}`,
    `admit: ${decision.admit}`,
  ];
  if (decision.admit) {
    lines.push(`bindingHits: ${decision.bindingHits.join(",") || "none"}`);
  } else {
    lines.push(`rejectReason: ${decision.reason}`);
  }
  return lines.join("\n");
}
