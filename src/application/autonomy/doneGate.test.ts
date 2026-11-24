import { expect, test } from "bun:test";
import {
  doneGate,
  gateAllowlistPaths,
  gateSanitizeVerify,
  gateRegexTestVerify,
} from "./doneGate.ts";

const WORKTREE = "/tmp/work";
const EVIDENCE_WRITE_INSIDE = `fs_write ${JSON.stringify({ path: "/tmp/work/out/report.md" })}\nWrote /tmp/work/out/report.md (42 bytes)`;
const EVIDENCE_WRITE_OUTSIDE = `fs_write ${JSON.stringify({ path: "/etc/bad.conf" })}\nWrote /etc/bad.conf (10 bytes)`;
const EVIDENCE_TREE_PROBE = `shell ${JSON.stringify({ command: "grep -r DETECTED_SECRET_ ." })}\n(no matches)`;
const EVIDENCE_GREP_RUN = `shell ${JSON.stringify({ command: "grep -E 'foo|bar' input.txt" })}\nmatched: 3 lines`;
const EVIDENCE_PYTEST_RUN = `shell ${JSON.stringify({ command: "python -m pytest tests/" })}\nCheck passed: 5 tests`;

// --- gateAllowlistPaths ---

test("gateAllowlistPaths: allow write inside worktree", () => {
  const v = gateAllowlistPaths(EVIDENCE_WRITE_INSIDE, WORKTREE, new Set());
  expect(v.allow).toBe(true);
});

test("gateAllowlistPaths: block write outside without grant", () => {
  const v = gateAllowlistPaths(EVIDENCE_WRITE_OUTSIDE, WORKTREE, new Set());
  expect(v.allow).toBe(false);
  if (!v.allow) {
    expect(v.gate).toBe("allowlist");
    expect(v.reason).toContain("/etc/bad.conf");
  }
});

test("gateAllowlistPaths: allow write outside with matching grant", () => {
  const v = gateAllowlistPaths(EVIDENCE_WRITE_OUTSIDE, WORKTREE, new Set(["/etc"]));
  expect(v.allow).toBe(true);
});

// --- gateSanitizeVerify ---

test("gateSanitizeVerify: allow non-sanitize goal", () => {
  const v = gateSanitizeVerify("write a report about cats", "");
  expect(v.allow).toBe(true);
});

test("gateSanitizeVerify: block sanitize goal without tree probe", () => {
  const v = gateSanitizeVerify("sanitize secrets in the repo", "shell cat file.txt\nsome content");
  expect(v.allow).toBe(false);
  if (!v.allow) {
    expect(v.gate).toBe("sanitize");
    expect(v.reason).toContain("tree-wide");
  }
});

test("gateSanitizeVerify: allow sanitize goal with tree probe", () => {
  const v = gateSanitizeVerify("sanitize secrets in the repo", EVIDENCE_TREE_PROBE);
  expect(v.allow).toBe(true);
});

// --- gateRegexTestVerify ---

test("gateRegexTestVerify: allow non-regex/test goal", () => {
  const v = gateRegexTestVerify("write a summary", "");
  expect(v.allow).toBe(true);
});

test("gateRegexTestVerify: block regex goal without run", () => {
  const v = gateRegexTestVerify("write a regex to match emails", "fs_write out/regex.py\nWrote out/regex.py");
  expect(v.allow).toBe(false);
  if (!v.allow) {
    expect(v.gate).toBe("regex_test");
    expect(v.reason).toContain("regex");
  }
});

test("gateRegexTestVerify: allow regex goal with grep run", () => {
  const v = gateRegexTestVerify("write a regex to match emails", EVIDENCE_GREP_RUN);
  expect(v.allow).toBe(true);
});

test("gateRegexTestVerify: block test goal without run", () => {
  const v = gateRegexTestVerify("write a test for the parser", "fs_write out/test_parser.py\nWrote out/test_parser.py");
  expect(v.allow).toBe(false);
  if (!v.allow) expect(v.gate).toBe("regex_test");
});

test("gateRegexTestVerify: allow test goal with pytest run", () => {
  const v = gateRegexTestVerify("write a test for the parser", EVIDENCE_PYTEST_RUN);
  expect(v.allow).toBe(true);
});

test("gateRegexTestVerify: block soft-regex failClass without run", () => {
  const v = gateRegexTestVerify("fix the matcher", "fs_write out/matcher.py\nWrote out/matcher.py", "soft-regex");
  expect(v.allow).toBe(false);
});

// --- doneGate (integration) ---

test("doneGate: no gates fire on pass review with clean evidence", () => {
  const v = doneGate({
    goal: "write `out/report.md`",
    evidence: EVIDENCE_WRITE_INSIDE,
    reviewVerdict: "pass",
    worktreePath: WORKTREE,
    outsideGrants: new Set(),
  });
  expect(v.allow).toBe(true);
});

test("doneGate: does not fire on non-pass review (judgeReview already handles)", () => {
  const v = doneGate({
    goal: "sanitize secrets",
    evidence: "",
    reviewVerdict: "fail",
    worktreePath: WORKTREE,
    outsideGrants: new Set(),
  });
  expect(v.allow).toBe(true);
});

test("doneGate: allowlist blocks done even on pass review", () => {
  const v = doneGate({
    goal: "write config",
    evidence: EVIDENCE_WRITE_OUTSIDE,
    reviewVerdict: "pass",
    worktreePath: WORKTREE,
    outsideGrants: new Set(),
  });
  expect(v.allow).toBe(false);
  if (!v.allow) expect(v.gate).toBe("allowlist");
});

test("doneGate: sanitize gate blocks done on pass review without probe", () => {
  const v = doneGate({
    goal: "sanitize secrets in the repo",
    evidence: EVIDENCE_WRITE_INSIDE,
    reviewVerdict: "pass",
    worktreePath: WORKTREE,
    outsideGrants: new Set(),
  });
  expect(v.allow).toBe(false);
  if (!v.allow) expect(v.gate).toBe("sanitize");
});
