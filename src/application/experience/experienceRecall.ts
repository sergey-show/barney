import type { Episode } from "../../domain/memory/Episode.ts";
import type { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import type { PickedRule } from "../context/lessonRule.ts";
import type { TurnRecallContext } from "../services/TurnRecallService.ts";
import { clipText } from "../context/packSession.ts";

/** Mandatory pre-act recall bags — Shadow / Rules / Skills. */
export type ExperienceRecallBags = {
  shadow: string[];
  rules: string[];
  skills: string[];
  episodeLines: string[];
};

export type ExperienceRecallSignal = {
  /** Relevant experience was injected into the act prompt. */
  recallHit: boolean;
  /**
   * Heuristic: act/plan text or first tools echo a recalled rule/skill/shadow token.
   * Not proof the model "understood" — only that the prompt left a fingerprint.
   */
  recallUsed: boolean;
  /**
   * Post-hoc: success with recallUsed. Without a fresh counterfactual arm this is
   * correlational — 4-hand curriculum measures causal help.
   */
  recallHelped: boolean | null;
  bags: ExperienceRecallBags;
  line: string;
};

export function buildExperienceBags(
  recall: TurnRecallContext,
  opts?: { shadowWarnings?: string; skillHints?: string[] },
): ExperienceRecallBags {
  const shadow = [
    ...(opts?.shadowWarnings
      ? opts.shadowWarnings.split("\n").map((line) => line.trim()).filter(Boolean)
      : []),
    ...recall.relevantEpisodes
      .filter((episode) => episode.outcome === "fail")
      .slice(0, 3)
      .map((episode) =>
        `[fail:${episode.failureMode ?? "unknown"}] ${clipText(episode.nextHint || episode.goal, 160)}`),
  ];
  const rules = recall.pickedRules.slice(0, 5).map((rule) => `[rule:${rule.key}] ${clipText(rule.line, 180)}`);
  const skills = (opts?.skillHints ?? []).slice(0, 5);
  const episodeLines = recall.relevantEpisodes
    .filter((episode) => episode.outcome === "success")
    .slice(0, 3)
    .map((episode) =>
      `[ok:${episode.taskClass}] ${clipText(episode.goal, 100)} → ${clipText(episode.nextHint, 140)}`);
  return { shadow, rules, skills, episodeLines };
}

export function renderExperienceRecall(bags: ExperienceRecallBags): string {
  const blocks = [
    bags.shadow.length
      ? `Shadow recall (similar fails — do not repeat):\n${bags.shadow.map((line) => `- ${line}`).join("\n")}`
      : "",
    bags.rules.length
      ? `Rule recall (failure-mode directives — obey when relevant):\n${bags.rules.map((line) => `- ${line}`).join("\n")}`
      : "",
    bags.skills.length
      ? `Skill recall (verified/quarantine body hints):\n${bags.skills.map((line) => `- ${line}`).join("\n")}`
      : "",
    bags.episodeLines.length
      ? `Episode facts (same-class successes):\n${bags.episodeLines.map((line) => `- ${line}`).join("\n")}`
      : "",
  ].filter(Boolean);
  if (!blocks.length) return "";
  return [
    "Experience (retrieved; use only when it changes the plan or tool choice):",
    ...blocks,
    "Never invent a memory absent above. Prefer a recalled rule over repeating a failed family.",
  ].join("\n\n");
}

export function experienceRecallHit(bags: ExperienceRecallBags): boolean {
  return bags.shadow.length + bags.rules.length + bags.skills.length + bags.episodeLines.length > 0;
}

export function formatBagsCount(bags: ExperienceRecallBags): string {
  return `shadow=${bags.shadow.length} rules=${bags.rules.length} skills=${bags.skills.length} episodes=${bags.episodeLines.length}`;
}

/** Tokens that, if echoed in act/plan/tools, count as recall_used. */
export function recallFingerprints(bags: ExperienceRecallBags): string[] {
  const out: string[] = [];
  for (const line of [...bags.rules, ...bags.skills, ...bags.shadow]) {
    const ruleKey = /\[rule:([^\]]+)\]/.exec(line)?.[1];
    if (ruleKey) out.push(ruleKey);
    const failMode = /\[fail:([^\]]+)\]/.exec(line)?.[1];
    if (failMode && failMode !== "unknown") out.push(failMode);
    const skill = /skill[\/:\s]+([a-z0-9._-]+)/i.exec(line)?.[1];
    if (skill) out.push(skill);
    // Distinctive short phrases from the body (3+ word chunks are too noisy; take placeholders / verbs).
    for (const token of line.match(/<your-[a-z0-9-]+>|fs_write|fs_edit|do not|don't|avoid|prefer|instead/gi) ?? []) {
      out.push(token.toLowerCase());
    }
  }
  return [...new Set(out.map((token) => token.toLowerCase()).filter((token) => token.length >= 3))];
}

export function detectRecallUsed(bags: ExperienceRecallBags, haystack: string): boolean {
  if (!experienceRecallHit(bags)) return false;
  const text = haystack.toLowerCase();
  return recallFingerprints(bags).some((token) => text.includes(token));
}

export function formatRecallSignalLine(signal: Omit<ExperienceRecallSignal, "bags" | "line"> & { bags: ExperienceRecallBags }): string {
  const helped = signal.recallHelped == null ? "?" : signal.recallHelped ? "1" : "0";
  return [
    `recall_hit: ${signal.recallHit ? 1 : 0}`,
    `recall_used: ${signal.recallUsed ? 1 : 0}`,
    `recall_helped: ${helped}`,
    `bags: shadow=${signal.bags.shadow.length} rules=${signal.bags.rules.length} skills=${signal.bags.skills.length} episodes=${signal.bags.episodeLines.length}`,
  ].join(" · ");
}

export function finalizeRecallSignal(input: {
  bags: ExperienceRecallBags;
  actText: string;
  planText?: string;
  toolEvidence?: string;
  outcomeOk: boolean;
}): ExperienceRecallSignal {
  const hit = experienceRecallHit(input.bags);
  const used = detectRecallUsed(
    input.bags,
    [input.planText ?? "", input.actText, input.toolEvidence ?? ""].join("\n"),
  );
  const helped = hit && used ? input.outcomeOk : hit && used === false ? false : null;
  const partial = { recallHit: hit, recallUsed: used, recallHelped: helped, bags: input.bags };
  return {
    ...partial,
    line: formatRecallSignalLine(partial),
  };
}

export type { Episode, MemoryNote, PickedRule };
