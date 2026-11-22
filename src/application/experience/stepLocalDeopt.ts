/**
 * Step-local deoptimization (SkillCache):
 * when a procedure fails, blame one step — keep the rest — resume after it.
 * Do not throw away the whole skill on a single bad step.
 */

export type DeoptPlan = {
  skill: string;
  failedStep: number; // 0-based; -1 = unknown
  keep: string[];
  retry: string | null;
  resume: string[];
  line: string;
  prompt: string;
};

export function locateFailedStep(input: {
  procedure: string[];
  evidence?: string;
  errorHint?: string;
}): number {
  const proc = input.procedure.map((s) => s.trim()).filter(Boolean);
  if (!proc.length) return -1;
  const hay = `${input.evidence ?? ""}\n${input.errorHint ?? ""}`.toLowerCase();
  if (!hay.trim()) return Math.max(0, proc.length - 1); // fail late if no signal
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < proc.length; i++) {
    const tokens = proc[i]!.toLowerCase().split(/[^a-z0-9_<>.-]+/).filter((t) => t.length > 2);
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
    }
    // Prefer later matching steps slightly (errors usually after the bad action).
    score += i * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore > 0 ? best : Math.max(0, proc.length - 1);
}

export function planStepLocalDeopt(input: {
  skill: string;
  procedure: string[];
  evidence?: string;
  errorHint?: string;
}): DeoptPlan {
  const procedure = input.procedure.map((s) => s.trim()).filter(Boolean);
  const failedStep = locateFailedStep({
    procedure,
    evidence: input.evidence,
    errorHint: input.errorHint,
  });
  if (failedStep < 0 || !procedure.length) {
    return {
      skill: input.skill,
      failedStep: -1,
      keep: procedure,
      retry: null,
      resume: [],
      line: `step_deopt: skill=${input.skill} · none`,
      prompt: "",
    };
  }
  const keep = procedure.slice(0, failedStep);
  const retry = procedure[failedStep] ?? null;
  const resume = procedure.slice(failedStep + 1);
  const line =
    `step_deopt: skill=${input.skill} · fail_step=${failedStep + 1}/${procedure.length}`
    + (retry ? ` · retry=${clip(retry, 60)}` : "");
  const prompt = [
    `STEP-LOCAL DEOPT (skill:${input.skill}): step ${failedStep + 1} failed — do NOT restart the whole skill.`,
    keep.length ? `Already ok (skip): ${keep.join(" → ")}` : "Already ok: (none)",
    retry ? `Retry only this step with source skill available: ${retry}` : "Retry: (unknown step)",
    resume.length ? `Then continue: ${resume.join(" → ")}` : "Then continue: (done after retry)",
  ].join("\n");
  return { skill: input.skill, failedStep, keep, retry, resume, line, prompt };
}

/** Patch procedure: annotate failed step; keep others intact. */
export function annotateProcedureDeopt(
  procedure: string[],
  failedStep: number,
): string[] {
  return procedure.map((step, i) => {
    const clean = step.replace(/\s*\[deopt\]\s*$/i, "").trim();
    if (i === failedStep) return `${clean} [deopt]`;
    return clean;
  });
}

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
