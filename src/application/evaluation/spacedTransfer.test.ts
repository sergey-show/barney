import { expect, test } from "bun:test";
import {
  buildSpacedAnchors,
  dueSpacedDelays,
  markDelayDone,
  planSpacedProbes,
  summarizeSpacedRetention,
} from "./spacedTransfer.ts";

test("planSpacedProbes labels", () => {
  const plan = planSpacedProbes();
  expect(plan.map((p) => p.label)).toEqual(["immediate", "+24h", "+7d"]);
});

test("summarizeSpacedRetention retains when later lift > 0", () => {
  const report = summarizeSpacedRetention("house-redact", [
    { caseId: "house-redact", delayHours: 0, transferSuccessLift: 1 },
    { caseId: "house-redact", delayHours: 24, transferSuccessLift: 1 },
    { caseId: "house-redact", delayHours: 168, transferSuccessLift: 1 },
  ]);
  expect(report.verdict).toBe("retains");
  expect(report.forgetting).toBe(0);
});

test("buildSpacedAnchors schedules +1d/+7d", () => {
  const anchors = buildSpacedAnchors({
    cases: [{ caseId: "house-redact", trainHome: "/tmp/home", transferSuccessLift: 1 }],
    trainedAt: "2026-11-18T00:00:00.000Z",
  });
  expect(anchors[0]!.dueDelayHours).toEqual([24, 168]);
});

test("dueSpacedDelays respects clock and force", () => {
  const anchor = buildSpacedAnchors({
    cases: [{ caseId: "x", trainHome: "/tmp", transferSuccessLift: 1 }],
    trainedAt: "2026-11-17T00:00:00.000Z",
  })[0]!;
  const due = dueSpacedDelays(anchor, new Date("2026-11-18T02:00:00.000Z"));
  expect(due).toContain(24);
  expect(due).not.toContain(168);
  expect(dueSpacedDelays(anchor, new Date(), 168)).toEqual([168]);
  expect(markDelayDone(anchor, 24).dueDelayHours).toEqual([168]);
});
