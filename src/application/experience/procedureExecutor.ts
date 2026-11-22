/**
 * Minimal procedure executor (CPU-ARC analogue):
 * consecutive mechanical steps run as one streak without re-planning.
 * Semantic / judgment steps stop the streak and return control to the model.
 *
 * This module plans and prompts — it does not bypass safety gates or invent
 * tool args. The act loop still executes tools under self-gate.
 */

export type ProcedureStepKind = "mechanical" | "semantic";

export type ClassifiedStep = {
  index: number;
  text: string;
  family: string;
  kind: ProcedureStepKind;
};

export type ProcedureExecPlan = {
  skill: string;
  steps: ClassifiedStep[];
  /** Consecutive mechanical steps from cursor. */
  streak: ClassifiedStep[];
  /** Index where streak ends (semantic or end). */
  stopAt: number;
  line: string;
  prompt: string;
};

const MECHANICAL_FAMILIES = new Set([
  "fs",
  "shell",
  "shell:grep",
  "shell:sed",
  "shell:cat",
  "shell:cp",
  "shell:mv",
  "shell:mkdir",
  "shell:rm",
  "shell:ls",
  "shell:find",
  "shell:head",
  "shell:tail",
  "shell:wc",
  "shell:python",
  "shell:python3",
  "shell:node",
  "shell:bun",
  "memory",
]);

const MECHANICAL_VERBS = [
  "read",
  "write",
  "copy",
  "move",
  "list",
  "grep",
  "replace",
  "mask",
  "redact",
  "cat",
  "mkdir",
  "open",
  "save",
  "append",
  "delete",
  "remove",
  "run",
  "verify",
  "check",
];

/**
 * Map a free-text procedure step to a tool family hint.
 */
export function stepFamily(step: string): string {
  const t = step.trim().toLowerCase();
  if (!t) return "unknown";
  // Already a family key from LessonTrail (fs, shell:grep, …)
  if (/^(fs|shell|browser|plugin|memory|self|team|mcp)(:[a-z0-9_-]+)?$/.test(t)) {
    return t;
  }
  if (t.startsWith("shell:") || t.startsWith("fs_") || t.startsWith("fs:")) {
    return t.replace(/^fs:/, "fs").replace(/^fs_/, "fs");
  }
  if (/\bgrep\b/.test(t) || /\brg\b/.test(t)) return "shell:grep";
  if (/\b(write|save|append|create file)\b/.test(t)) return "fs";
  if (/\b(read|cat|open file|list)\b/.test(t)) return "fs";
  if (/\b(replace|sed|mask|redact)\b/.test(t)) return "shell:sed";
  if (/\b(verify|check|test)\b/.test(t)) return "shell:grep";
  if (/\b(python|node|bun)\b/.test(t)) return "shell";
  return "semantic";
}

export function classifyStep(step: string, index: number): ClassifiedStep {
  const text = step.replace(/\s*\[deopt\]\s*$/i, "").trim();
  const family = stepFamily(text);
  const mechanical = isMechanical(family, text);
  return {
    index,
    text,
    family,
    kind: mechanical ? "mechanical" : "semantic",
  };
}

export function classifyProcedure(procedure: string[]): ClassifiedStep[] {
  return procedure.map((step, i) => classifyStep(step, i));
}

/**
 * Plan a consecutive mechanical streak starting at `from` (default 0).
 * Skips already-marked [deopt] only when starting mid-procedure after deopt.
 */
export function planProcedureExec(input: {
  skill: string;
  procedure: string[];
  from?: number;
}): ProcedureExecPlan {
  const steps = classifyProcedure(input.procedure);
  const from = Math.max(0, input.from ?? 0);
  const streak: ClassifiedStep[] = [];
  let stopAt = from;
  for (let i = from; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.kind !== "mechanical") {
      stopAt = i;
      break;
    }
    streak.push(step);
    stopAt = i + 1;
  }
  if (!streak.length) {
    return {
      skill: input.skill,
      steps,
      streak: [],
      stopAt: from,
      line: `procedure_exec: skill=${input.skill} · streak=0 · handoff=model`,
      prompt: "",
    };
  }
  const line =
    `procedure_exec: skill=${input.skill} · streak=${streak.length}`
    + ` · from=${from + 1} · stop=${stopAt}/${steps.length}`
    + ` · families=${streak.map((s) => s.family).join("→")}`;
  const prompt = [
    `PROCEDURE EXEC (skill:${input.skill}): run these consecutive mechanical steps now — do not re-plan between them.`,
    ...streak.map((s) => `${s.index + 1}. [${s.family}] ${s.text}`),
    stopAt < steps.length
      ? `After the streak, stop and reason about step ${stopAt + 1}: ${steps[stopAt]!.text}`
      : "After the streak, verify outcomes and finish.",
  ].join("\n");
  return { skill: input.skill, steps, streak, stopAt, line, prompt };
}

function isMechanical(family: string, text: string): boolean {
  if (family === "semantic" || family === "unknown") {
    // Verb heuristic for free-text steps without a family id.
    const lower = text.toLowerCase();
    return MECHANICAL_VERBS.some((v) => lower.includes(v));
  }
  if (MECHANICAL_FAMILIES.has(family)) return true;
  if (family.startsWith("shell:") || family === "fs" || family === "shell") return true;
  // browser / plugin / team / mcp need judgment
  return false;
}
