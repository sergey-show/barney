import type { StrategyName } from "../../domain/run/Strategy.ts";
import type { ProgressSnapshot } from "./progressSignal.ts";

/**
 * Tactical focus inside a coarse strategy — prefer unsaturated families that
 * historically recover delivery work.
 */
export type TacticPick = {
  preferFamilies: string[];
  avoidFamilies: string[];
  steps: string[];
  line: string;
};

export function pickTactic(input: {
  strategy: StrategyName;
  saturated: string[];
  progress?: ProgressSnapshot | null;
  failedFamily?: string;
}): TacticPick {
  const saturated = new Set(input.saturated);
  const avoid = [...saturated];
  if (input.failedFamily) avoid.push(input.failedFamily);

  const prefer: string[] = [];
  const delivery = !input.progress || input.progress.taskKind !== "research";
  if (delivery) {
    for (const fam of ["fs_edit", "fs_write", "shell:sed", "shell:python3"]) {
      if (!saturated.has(fam) && !saturated.has(fam.split(":")[0] ?? "")) prefer.push(fam);
    }
  } else {
    for (const fam of ["browser", "web_search", "fs_read"]) {
      if (!saturated.has(fam)) prefer.push(fam);
    }
  }

  const steps: string[] = [];
  if (input.progress && input.progress.inspections > 0 && input.progress.mutates === 0 && delivery) {
    steps.push("Apply edits now (fs_edit/fs_write/sed -i); do not inventory again");
    steps.push("Probe each edited path; confirm the ask is satisfied");
  } else if (input.progress && input.progress.missingArtifacts > 0) {
    steps.push("Write only the still-missing paths");
    steps.push("Validate each new file once");
  } else if (input.strategy === "decompose") {
    steps.push("One concrete tool call per remaining gap");
    steps.push("Stop planning; execute the next gap");
  } else {
    steps.push("Change tool family away from saturated ones");
    steps.push("Deliver a checkable result this approach");
  }
  if (steps.length < 3) steps.push("If blocked, switch family — do not repeat the failed call");

  const line = [
    prefer.length ? `Prefer: ${prefer.slice(0, 3).join(", ")}` : "",
    avoid.length ? `Avoid: ${[...new Set(avoid)].slice(0, 4).join(", ")}` : "",
    `Attack: ${steps.slice(0, 3).join(" → ")}`,
  ].filter(Boolean).join(". ");

  return { preferFamilies: prefer.slice(0, 4), avoidFamilies: [...new Set(avoid)].slice(0, 4), steps: steps.slice(0, 4), line };
}
