import { expect, test } from "bun:test";
import { decideForceArtifact, forceArtifactNudge } from "./forceArtifact.ts";

const EVIDENCE_WROTE = (path: string) =>
  `fs_write ${JSON.stringify({ path })}\nWrote ${path} (42 bytes)`;
// shell redirect that failed (exit 1) — reviewJudge marks this as poison → unwritten
const EVIDENCE_FAILED = (path: string) =>
  `shell ${JSON.stringify({ cmd: `cat > ${path}` })}\nerror: permission denied\nexit 1`;

test("no force before midpoint", () => {
  const d = decideForceArtifact({
    step: 1,
    maxSteps: 10,
    goal: "write `out/report.md` with the summary",
    evidence: "",
  });
  expect(d.force).toBe(false);
});

test("no force when no requested artifact", () => {
  const d = decideForceArtifact({
    step: 6,
    maxSteps: 10,
    goal: "explain the architecture",
    evidence: "",
  });
  expect(d.force).toBe(false);
});

test("no force when artifact already written", () => {
  const d = decideForceArtifact({
    step: 6,
    maxSteps: 10,
    goal: "write `out/report.md` with the summary",
    evidence: EVIDENCE_WROTE("out/report.md"),
  });
  expect(d.force).toBe(false);
});

test("force at midpoint when target unwritten", () => {
  const d = decideForceArtifact({
    step: 5,
    maxSteps: 10,
    goal: "write `out/report.md` with the summary",
    evidence: "",
  });
  expect(d.force).toBe(true);
  if (d.force) {
    expect(d.path).toBe("out/report.md");
    expect(d.reason).toContain("mid-budget");
    expect(d.reason).toContain("out/report.md");
  }
});

test("force targets first missing when multiple requested", () => {
  const d = decideForceArtifact({
    step: 7,
    maxSteps: 10,
    goal: "write `a.txt` and `b.txt` with notes",
    evidence: EVIDENCE_WROTE("b.txt"),
  });
  expect(d.force).toBe(true);
  if (d.force) expect(d.path).toBe("a.txt");
});

test("force reason notes prior failed write", () => {
  const d = decideForceArtifact({
    step: 6,
    maxSteps: 10,
    goal: "write `out/report.md` with the summary",
    evidence: EVIDENCE_FAILED("out/report.md"),
  });
  expect(d.force).toBe(true);
  if (d.force) expect(d.reason).toContain("captured an error");
});

test("no force when budget too short", () => {
  const d = decideForceArtifact({
    step: 1,
    maxSteps: 3,
    goal: "write `out/report.md`",
    evidence: "",
  });
  expect(d.force).toBe(false);
});

test("nudge is imperative and names the path", () => {
  const n = forceArtifactNudge({
    force: true,
    path: "out/report.md",
    reason: "mid-budget (6/10) and out/report.md still unwritten",
  });
  expect(n).toContain("[force-artifact]");
  expect(n).toContain("out/report.md");
  expect(n).toContain("fs_write");
  expect(n).toContain("minimal");
});

// --- Post-review forced write (B.1) ---

import { decideForceArtifactPostReview } from "./forceArtifact.ts";

test("post-review: no force on pass verdict", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `out/report.md`",
    evidence: "",
    reviewVerdict: "pass",
    reviewFailureKind: "missing-artifact",
    reviewMissing: "Not yet written: out/report.md",
  });
  expect(d.force).toBe(false);
});

test("post-review: force when fail + missing-artifact kind", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `out/report.md`",
    evidence: "",
    reviewVerdict: "fail",
    reviewFailureKind: "missing-artifact",
    reviewMissing: "Not yet written: out/report.md",
  });
  expect(d.force).toBe(true);
  if (d.force) {
    expect(d.path).toBe("out/report.md");
    expect(d.reason).toContain("not yet written");
  }
});

test("post-review: force when missing string names a path even without kind", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `out/report.md`",
    evidence: "",
    reviewVerdict: "fail",
    reviewMissing: "the file out/report.md is missing",
  });
  expect(d.force).toBe(true);
  if (d.force) expect(d.path).toBe("out/report.md");
});

test("post-review: no force when fail but no missing-artifact signal", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `out/report.md`",
    evidence: "",
    reviewVerdict: "fail",
    reviewFailureKind: "general",
    reviewMissing: "the answer was too vague",
  });
  expect(d.force).toBe(false);
});

test("post-review: no force when artifact already written", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `out/report.md`",
    evidence: EVIDENCE_WROTE("out/report.md"),
    reviewVerdict: "fail",
    reviewFailureKind: "missing-artifact",
    reviewMissing: "Not yet written: out/report.md",
  });
  expect(d.force).toBe(false);
});

test("post-review: reason notes prior failed write", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `out/report.md`",
    evidence: EVIDENCE_FAILED("out/report.md"),
    reviewVerdict: "fail",
    reviewFailureKind: "missing-artifact",
    reviewMissing: "Not yet written: out/report.md",
  });
  expect(d.force).toBe(true);
  if (d.force) expect(d.reason).toContain("captured an error");
});

test("post-review: falls back to unwrittenArtifacts(goal) when review missing is vague", () => {
  const d = decideForceArtifactPostReview({
    goal: "write `a.txt` and `b.txt`",
    evidence: EVIDENCE_WROTE("b.txt"),
    reviewVerdict: "fail",
    reviewFailureKind: "missing-artifact",
    reviewMissing: "deliverable missing",
  });
  expect(d.force).toBe(true);
  if (d.force) expect(d.path).toBe("a.txt");
});
