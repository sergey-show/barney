/**
 * Replay-before-admit for skill capsules (SkillCache-style).
 *
 * Before a quarantine skill may enter SkillsLock:
 * 1) structure — procedure present and non-empty steps
 * 2) bindings — request-looking literals lifted (no hardcoded paths/urls/ids)
 * 3) replay — dry structural qualification of steps
 *
 * Fallback ladder: executable procedure → text procedure → source-only (no lock).
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";
import { skillEligibleForLock } from "../context/bodyStability.ts";

export type CapsuleForm = "hybrid" | "text" | "source";

export type SkillReplayDecision = {
  admit: boolean;
  form: CapsuleForm;
  reason: string;
  bindingHits: string[];
  repairedProcedure?: string[];
};

const HARDCODE_PATTERNS: Array<{ name: string; pattern: string }> = [
  { name: "abs_path", pattern: "\\/(?:Users|home|tmp|var|etc)\\/\\S+" },
  { name: "file_url", pattern: "file:\\/\\/\\S+" },
  { name: "http_url", pattern: "https?:\\/\\/[^\\s\"'`]+" },
  { name: "uuid", pattern: "\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b" },
  { name: "long_hex", pattern: "\\b[0-9a-f]{32,}\\b" },
];

const BINDING_SLOT = "<binding>";

/**
 * Lift request-looking literals into binding slots so capsules transfer.
 */
export function liftBindings(procedure: string[]): {
  procedure: string[];
  hits: string[];
} {
  const hits: string[] = [];
  const next = procedure.map((step) => {
    let out = step;
    for (const { name, pattern } of HARDCODE_PATTERNS) {
      const re = new RegExp(pattern, "gi");
      if (!re.test(out)) continue;
      hits.push(name);
      out = out.replace(new RegExp(pattern, "gi"), BINDING_SLOT);
    }
    return out.replace(/\s+/g, " ").trim();
  }).filter(Boolean);
  return { procedure: next, hits: [...new Set(hits)] };
}

export function qualifyProcedureStructure(procedure: string[] | undefined): {
  ok: boolean;
  reason: string;
} {
  if (!procedure?.length) {
    return { ok: false, reason: "no procedure steps" };
  }
  if (procedure.some((step) => !step.trim())) {
    return { ok: false, reason: "empty procedure step" };
  }
  if (procedure.length > 24) {
    return { ok: false, reason: "procedure too long (>24 steps)" };
  }
  return { ok: true, reason: "structure ok" };
}

/** Dry replay: each step must still be an actionable phrase after lifting. */
export function replayProcedure(procedure: string[]): {
  ok: boolean;
  reason: string;
} {
  if (!procedure.length) return { ok: false, reason: "replay · empty after lift" };
  for (const [i, step] of procedure.entries()) {
    const tokens = step.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      return { ok: false, reason: `replay · step ${i + 1} too thin` };
    }
    // A step that is only bindings is not executable guidance.
    if (tokens.every((t) => t === BINDING_SLOT || /^[,.;:]+$/.test(t))) {
      return { ok: false, reason: `replay · step ${i + 1} is bindings only` };
    }
  }
  return { ok: true, reason: "replay ok" };
}

/**
 * Gate SkillsLock promotion. Source skill body always remains in memory;
 * this only decides whether the capsule may pin into the lock.
 */
export function admitSkillCapsule(rec: SkillBodyRecord): SkillReplayDecision {
  if (!skillEligibleForLock(rec)) {
    return {
      admit: false,
      form: "source",
      reason: "status not verified/frozen — source-only",
      bindingHits: [],
    };
  }

  const structure = qualifyProcedureStructure(rec.procedure);
  if (!structure.ok) {
    // Verified without procedure → text form: allow lock but flag form.
    return {
      admit: true,
      form: "text",
      reason: `text procedure · ${structure.reason}`,
      bindingHits: [],
    };
  }

  const lifted = liftBindings(rec.procedure ?? []);
  const replay = replayProcedure(lifted.procedure);
  if (!replay.ok) {
    return {
      admit: true,
      form: "text",
      reason: `fallback text · ${replay.reason}`,
      bindingHits: lifted.hits,
      repairedProcedure: lifted.procedure,
    };
  }

  return {
    admit: true,
    form: "hybrid",
    reason: lifted.hits.length
      ? `hybrid · replay ok · lifted ${lifted.hits.join(",")}`
      : "hybrid · replay ok",
    bindingHits: lifted.hits,
    repairedProcedure: lifted.hits.length ? lifted.procedure : undefined,
  };
}
