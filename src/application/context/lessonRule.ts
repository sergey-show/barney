import { redactSecrets } from "./packSession.ts";
import { slugKey } from "../../domain/memory/MemoryNote.ts";

export type LessonInput = {
  taskClass: string;
  goal: string;
  latest?: string;
  verdict: string;
  summary: string;
  missing?: string;
  anchors?: string[];
  operatorCorrected?: boolean;
  failClass?: string;
};

export type LessonRule = {
  key: string;
  title: string;
  body: string;
  topic: string;
};

export function lessonRule(input: LessonInput): LessonRule {
  const topic = ruleTopic(input);
  const body = redactSecrets(specificLesson(input) ?? genericLesson(input, topic));
  return {
    key: slugKey(`rule/${input.taskClass}/${topic}`),
    title: `Rule: ${topic}`,
    body,
    topic,
  };
}

export function pickRules(
  notes: Array<{ key: string; title: string; body: string; tags: string[] }>,
  taskClass: string,
  limit = 5,
  relatedKeys: string[] = [],
): string[] {
  const rules = notes.filter((note) => note.tags.includes("rule") || note.key.startsWith("rule/"));
  const related = new Set(relatedKeys);
  const ranked = [
    ...rules.filter((note) =>
      (note.tags.includes("fail") || note.tags.includes("experience"))
      && (note.tags.includes(taskClass) || note.key.includes(`/${taskClass}/`)),
    ),
    ...rules.filter((note) => related.has(note.key)),
    ...rules.filter((note) => note.tags.includes(taskClass) && !note.tags.includes("fail")),
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const note of ranked) {
    const line = redactSecrets(note.body.split("\n")[0] ?? "").trim();
    if (!line || seen.has(line) || isRecapLesson(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

function specificLesson(input: LessonInput): string | null {
  if (input.operatorCorrected) {
    return "If the operator says the last answer was wrong, fail it and re-check with tools; do not repeat the same claim.";
  }
  return null;
}

function genericLesson(input: LessonInput, topic: string): string {
  if (input.verdict === "pass") {
    return oneSentence(passTactic(input, topic));
  }
  const miss = input.missing || input.summary || "the previous approach failed";
  const klass = input.failClass && input.failClass !== "general" && input.failClass !== "aborted-unfinished"
    ? input.failClass
    : "";
  if (klass) {
    return oneSentence(`[${klass}] if ${miss}, change path; do not repeat the failed call.`);
  }
  return oneSentence(`For ${topic}: if ${miss}, change tool or path; do not repeat the failed call.`);
}

function passTactic(input: LessonInput, topic: string): string {
  return `For ${topic}: ${input.summary}`;
}

function ruleTopic(input: LessonInput): string {
  for (const anchor of input.anchors ?? []) {
    try {
      const host = new URL(anchor).hostname.replace(/\.$/, "");
      if (host) return host;
    } catch {
      const ip = anchor.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
      if (ip) return ip;
    }
  }
  return input.taskClass || "general";
}

export function isRecapLesson(line: string): boolean {
  return /session closed by user/i.test(line)
    || /agent successfully|successfully (opened|answered|read|used|retrieved)/i.test(line)
    || (/^For \w+:/i.test(line) && /successfully/i.test(line))
    || (/^When working on /i.test(line) && /successfully|agent (successfully|correctly)/i.test(line));
}

function oneSentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").replace(/Missing:\s*/gi, "").trim();
  const sentence = compact.split(/(?<=[.!?])\s/)[0] ?? compact;
  return sentence.length > 180 ? `${sentence.slice(0, 179)}…` : sentence;
}
