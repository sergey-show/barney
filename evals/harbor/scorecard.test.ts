import { expect, test } from "bun:test";
import {
  buildScorecard,
  detectInfraFail,
  passAtK,
  aggregateScoreboard,
  type ScorecardEntry,
} from "./scorecard.ts";

const baseInput = (over: Partial<Parameters<typeof buildScorecard>[0]> = {}): Parameters<typeof buildScorecard>[0] => ({
  task_id: "tb-001",
  status: "done",
  transcript: [
    { kind: "assistant", text: "I will write the file." },
    { kind: "console", text: "fs_write " + JSON.stringify({ path: "out.txt" }) + "\nWrote out.txt (42 bytes)" },
    { kind: "assistant", text: "Done." },
  ],
  tokens: 1000,
  usd: 0.01,
  duration_ms: 5000,
  ...over,
});

test("buildScorecard: clean pass", () => {
  const e = buildScorecard(baseInput());
  expect(e.status).toBe("pass");
  expect(e.infra_fail).toBe(false);
  expect(e.wrote_artifact).toBe(true);
  expect(e.reply_chars).toBe(5); // "Done."
  expect(e.steps).toBe(3);
});

test("buildScorecard: fail with missing-artifact", () => {
  const e = buildScorecard(baseInput({
    status: "failed",
    failureKind: "missing-artifact",
    transcript: [
      { kind: "assistant", text: "I will analyze." },
      { kind: "console", text: "shell cat input.txt\nsome content" },
      { kind: "assistant", text: "Here is the analysis." },
    ],
  }));
  expect(e.status).toBe("fail");
  expect(e.failure_kind).toBe("missing-artifact");
  expect(e.wrote_artifact).toBe(false);
});

test("buildScorecard: infra fail on permission block", () => {
  const e = buildScorecard(baseInput({
    status: "failed",
    transcript: [
      { kind: "system", text: "Outside path needs permission: /etc/host.conf. Allow with /allow /etc" },
      { kind: "assistant", text: "I cannot proceed." },
    ],
  }));
  expect(e.status).toBe("infra_fail");
  expect(e.infra_fail).toBe(true);
  expect(e.failure_kind).toBe("infra");
});

test("buildScorecard: infra fail on apt install error", () => {
  const e = buildScorecard(baseInput({
    status: "failed",
    transcript: [
      { kind: "console", text: "shell apt-get install -y jq\nReading package lists...\nE: Unable to locate package jq\nexit 100" },
    ],
  }));
  expect(e.infra_fail).toBe(true);
  expect(e.status).toBe("infra_fail");
});

test("buildScorecard: timeout counts as infra", () => {
  const e = buildScorecard(baseInput({
    status: "aborted",
    transcript: [
      { kind: "system", text: "aborted: step interrupted (AbortSignal.timeout)" },
    ],
  }));
  expect(e.status).toBe("timeout");
  expect(e.infra_fail).toBe(true);
});

test("buildScorecard: aborted without timeout marker", () => {
  const e = buildScorecard(baseInput({
    status: "aborted",
    transcript: [{ kind: "system", text: "aborted: step interrupted" }],
  }));
  expect(e.status).toBe("aborted");
  expect(e.infra_fail).toBe(true);
});

test("detectInfraFail: null on clean transcript", () => {
  expect(detectInfraFail([{ kind: "console", text: "fs_write out.txt\nok" }], "done")).toBeNull();
});

test("detectInfraFail: infra on pip install error", () => {
  expect(detectInfraFail(
    [{ kind: "console", text: "shell pip install foo\nerror: could not find\nexit 1" }],
    "failed",
  )).toBe("infra_fail");
});

test("passAtK: all pass → pass@1=1, pass@k=1", () => {
  const entries: ScorecardEntry[] = [
    { ...baseInput(), task_id: "a" } as never as ScorecardEntry,
  ];
  // build a real entry
  const e1 = buildScorecard(baseInput({ task_id: "a" }));
  const e2 = buildScorecard(baseInput({ task_id: "b" }));
  const stats = passAtK([e1, e2]);
  expect(stats.pass_at_1).toBe(1);
  expect(stats.pass_at_k).toBe(1);
  expect(stats.k).toBe(2);
});

test("passAtK: mixed pass/fail/infra", () => {
  const e1 = buildScorecard(baseInput({ task_id: "a" })); // pass
  const e2 = buildScorecard(baseInput({ task_id: "b", status: "failed" })); // fail
  const e3 = buildScorecard(baseInput({
    task_id: "c",
    status: "failed",
    transcript: [{ kind: "system", text: "Outside path needs permission: /etc/x" }],
  })); // infra
  const stats = passAtK([e1, e2, e3]);
  expect(stats.total).toBe(3);
  expect(stats.pass_at_1).toBeCloseTo(1 / 3, 4);
  expect(stats.pass_at_k).toBe(1); // at least one pass over 3 attempts
  expect(stats.infra_fails).toBe(1);
  expect(stats.pure_fails).toBe(1);
});

test("passAtK: empty → zeros", () => {
  const stats = passAtK([]);
  expect(stats.total).toBe(0);
  expect(stats.pass_at_1).toBe(0);
});

test("aggregateScoreboard: by_failure_kind breakdown", () => {
  const e1 = buildScorecard(baseInput({ task_id: "a" })); // pass, general
  const e2 = buildScorecard(baseInput({ task_id: "b", status: "failed", failureKind: "missing-artifact" }));
  const e3 = buildScorecard(baseInput({
    task_id: "c",
    status: "failed",
    transcript: [{ kind: "system", text: "Outside path needs permission: /etc/x" }],
  })); // infra
  const board = aggregateScoreboard([e1, e2, e3]);
  expect(board.total).toBe(3);
  expect(board.infra_fails).toBe(1);
  expect(board.by_failure_kind["missing-artifact"]).toBe(1);
  expect(board.by_failure_kind["infra"]).toBe(1);
  expect(board.avg_tokens).toBe(1000);
});
