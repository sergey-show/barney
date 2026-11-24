import { expect, test } from "bun:test";
import { admitNewSkill } from "../context/bodyStability.ts";
import {
  buildSubtaskIndex,
  formatSubroutineHint,
  matchSubtasks,
  selectSubtaskFastPath,
  tokenizeSubtask,
} from "./subtaskIndex.ts";

const frozenRedact = {
  ...admitNewSkill("house-redact-tokens", "sanitize", "secret-leak"),
  status: "frozen" as const,
  wins: 3,
  procedure: [
    "replace live secrets with house tokens",
    "write audit.txt counts",
    "canonicalize json layout sort keys",
  ],
};

const frozenMerge = {
  ...admitNewSkill("json-merge-canon", "merge", "config-rollout"),
  status: "frozen" as const,
  wins: 4,
  procedure: [
    "read base config and overlay patch",
    "sort nested keys ascending",
    "emit compact canonical json",
  ],
};

const quarantined = {
  ...admitNewSkill("temp", "sanitize", "secret-leak"),
  procedure: ["replace secrets"],
};

test("tokenizeSubtask drops stopwords and short tokens", () => {
  const t = tokenizeSubtask("the secret replace live secrets with house tokens now");
  expect(t).not.toContain("the");
  expect(t).not.toContain("now");
  expect(t).toContain("secret");
  expect(t).toContain("replace");
  expect(t.every((x) => x.length > 2)).toBe(true);
});

test("buildSubtaskIndex indexes only frozen/verified steps", () => {
  const idx = buildSubtaskIndex([frozenRedact, quarantined]);
  expect(idx.entries).toHaveLength(3); // 3 steps of frozenRedact
  expect(idx.entries.every((e) => e.skill === "house-redact-tokens")).toBe(true);
  expect(idx.idf.size).toBeGreaterThan(0);
});

test("matchSubtasks retrieves the right step on a shifted, reworded goal", () => {
  const idx = buildSubtaskIndex([frozenRedact, frozenMerge]);
  // shifted wording: "scrub credentials using learned placeholder tokens and produce a count report"
  // should match step 1 of house-redact-tokens (replace live secrets with house tokens)
  const hits = matchSubtasks({
    index: idx,
    query: "scrub credentials using learned placeholder tokens and produce a count report",
    topK: 2,
  });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].skill).toBe("house-redact-tokens");
  expect(hits[0].stepIndex).toBe(0);
  expect(hits[0].prompt).toContain("SUBROUTINE HINT");
  expect(hits[0].prompt).toContain("replace live secrets with house tokens");
});

test("matchSubasks retrieves a single step (subroutine) not the whole capsule", () => {
  const idx = buildSubtaskIndex([frozenRedact, frozenMerge]);
  // only the sort-keys step is relevant; the secret steps must not win
  const hits = matchSubtasks({
    index: idx,
    query: "order nested json keys ascending before emitting",
    topK: 3,
  });
  expect(hits.length).toBeGreaterThan(0);
  // best hit should be a sort-keys step (from either capsule)
  const top = hits[0];
  expect(/sort|order|ascending|keys/i.test(top.stepText)).toBe(true);
});

test("perSkill dedup keeps the best step per skill", () => {
  const idx = buildSubtaskIndex([frozenRedact, frozenMerge]);
  const hits = matchSubtasks({
    index: idx,
    query: "replace live secrets with house tokens and write audit counts",
    topK: 5,
    perSkill: true,
  });
  const skills = new Set(hits.map((h) => h.skill));
  // no skill appears twice
  expect(hits.length).toBe(skills.size);
});

test("matchSubtasks respects minScore threshold", () => {
  const idx = buildSubtaskIndex([frozenRedact, frozenMerge]);
  const hits = matchSubtasks({
    index: idx,
    query: "completely unrelated cooking recipe for pasta",
    minScore: 0.9,
  });
  expect(hits).toHaveLength(0);
});

test("selectSubtaskFastPath returns empty when no frozen skills", () => {
  expect(selectSubtaskFastPath({ skills: [quarantined], query: "sanitize secrets" })).toHaveLength(0);
});

test("selectSubtaskFastPath end-to-end returns subroutine hint", () => {
  const hits = selectSubtaskFastPath({
    skills: [frozenRedact, frozenMerge],
    query: "scrub credentials using learned placeholder tokens and produce a count report",
    topK: 2,
  });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].skill).toBe("house-redact-tokens");
  expect(hits[0].line).toContain("subtask_match:");
});

test("formatSubroutineHint is a hint, not a forced fast-path", () => {
  const p = formatSubroutineHint("house-redact-tokens", 0, "replace live secrets with house tokens");
  expect(p).toContain("SUBROUTINE HINT");
  expect(p).toContain("reuse this proven step");
  expect(p).toContain("do not abandon the whole plan");
});
