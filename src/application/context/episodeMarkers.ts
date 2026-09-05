import type { ReuseKind } from "./transferLedger.ts";

/** Markers persisted on Episode for transfer / hold-out analytics. */
export function buildEpisodeMarkers(input: {
  source?: string;
  status?: string;
  goalHash: string;
  reuse: ReuseKind;
  rulesRecalled?: string[];
  failureMode?: string | null;
  progressScore?: number;
  experience?: boolean;
}): string[] {
  const markers: string[] = [];
  if (input.source) markers.push(`source:${input.source}`);
  if (input.status) markers.push(`status:${input.status}`);
  markers.push(`goalHash:${input.goalHash}`);
  markers.push(`reuse:${input.reuse}`);
  if (input.failureMode) markers.push(`failureMode:${input.failureMode}`);
  if (input.progressScore != null) markers.push(`progress:${Math.round(input.progressScore)}`);
  for (const key of (input.rulesRecalled ?? []).slice(0, 6)) {
    markers.push(`recalled:${key}`);
  }
  if (input.experience) markers.push("experience:fail");
  return markers;
}

export function ruleSourceClass(key: string, tags: string[] = []): string {
  const fromKey = key.match(/^rule\/([^/]+)\//)?.[1];
  if (fromKey && fromKey !== "mode") return fromKey;
  const mode = key.match(/^rule\/mode\/([^/]+)\//)?.[1];
  if (mode) return `mode:${mode}`;
  const tag = tags.find((t) => t && t !== "rule" && t !== "lesson" && t !== "fail" && t !== "experience" && !t.startsWith("conf:"));
  return tag || "general";
}
