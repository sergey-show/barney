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
  /** Prior approach prefer list — rotated away when stalled. */
  priorPrefer?: string[];
  /** No new evidence this approach — force a different family. */
  stalled?: boolean;
}): TacticPick {
  const saturated = new Set(input.saturated);
  const avoid = [...saturated];
  if (input.failedFamily) avoid.push(input.failedFamily);
  if (input.stalled && input.priorPrefer?.length) {
    for (const fam of input.priorPrefer) avoid.push(fam);
  }

  const prefer: string[] = [];
  const delivery = !input.progress || input.progress.taskKind !== "research";
  const candidates = delivery
    ? ["fs_edit", "fs_write", "shell:sed", "shell:python3", "shell:test"]
    : ["browser", "web_search", "fs_read", "grep"];
  for (const fam of candidates) {
    const root = fam.split(":")[0] ?? fam;
    if (saturated.has(fam) || saturated.has(root)) continue;
    if (avoid.includes(fam)) continue;
    prefer.push(fam);
  }
  // If stall wiped the list, take first unsaturated even if previously preferred.
  if (!prefer.length) {
    for (const fam of candidates) {
      const root = fam.split(":")[0] ?? fam;
      if (!saturated.has(fam) && !saturated.has(root)) prefer.push(fam);
    }
  }

  const steps: string[] = [];
  if (input.stalled) {
    steps.push("No new evidence — change tool family now");
    steps.push("Do not repeat the prior Prefer list");
  }
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
