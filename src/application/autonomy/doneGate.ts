/**
 * Done-gate (B.3): block `done` until allowlist + local verify/test pass for
 * sanitize and regex-class goals.
 *
 * The roadmap names this "discipline before done": allowlist paths + local
 * verify/test before claim done, especially for sanitize and regex-class
 * failures. `judgeReview` already catches missing artifacts, masked writes,
 * leftover secret masks, and unverified programs — but it does not enforce:
 *   1. Path allowlist: a write to a path outside the worktree (without an
 *      explicit grant) must block done, even if the reviewer said pass.
 *   2. Sanitize verify: for sanitize goals, done requires a tree-wide
 *      `grep -r DETECTED_SECRET_` (or equivalent) that comes back empty —
 *      not just a successful mutate in one file.
 *   3. Regex/test verify: for goals that ask for a regex or a test, done
 *      requires evidence that the regex was run (matched/rejected) or the
 *      test command was executed — not just the file written.
 *
 * This module is pure (no I/O, no LLM). It returns a verdict; the caller
 * (DriveSolve) blocks done when `allow === false` and routes back to persist.
 */

import { askedToReplaceSecrets, isTreeWideSecretProbe } from "../context/secretSanitize.ts";

export type DoneGateVerdict =
  | { allow: true }
  | { allow: false; reason: string; gate: "allowlist" | "sanitize" | "regex_test" };

/**
 * Top-level done-gate. Runs only when the reviewer already said pass —
 * it is a post-review discipline check, not a re-review.
 */
export function doneGate(input: {
  goal: string;
  evidence: string;
  /** Reviewer verdict — gate only fires on pass. */
  reviewVerdict: string;
  /** Worktree root path; writes outside this must have a grant. */
  worktreePath: string;
  /** Set of allowed outside-prefixes (from session grants). */
  outsideGrants: Set<string>;
  /** Fail class label, if known (e.g. "soft-regex", "sanitize"). */
  failClass?: string;
}): DoneGateVerdict {
  if (input.reviewVerdict !== "pass") return { allow: true };

  const allowlist = gateAllowlistPaths(input.evidence, input.worktreePath, input.outsideGrants);
  if (!allowlist.allow) return allowlist;

  const sanitize = gateSanitizeVerify(input.goal, input.evidence);
  if (!sanitize.allow) return sanitize;

  const regexTest = gateRegexTestVerify(input.goal, input.evidence, input.failClass);
  if (!regexTest.allow) return regexTest;

  return { allow: true };
}

/**
 * Path allowlist: every fs_write/shell-redirect target must be inside the
 * worktree OR covered by an outside grant. A write outside without a grant
 * blocks done — the deliverable may have landed in the wrong place.
 */
export function gateAllowlistPaths(
  evidence: string,
  worktreePath: string,
  outsideGrants: Set<string>,
): DoneGateVerdict {
  const writes = extractWritePaths(evidence);
  const worktree = worktreePath.replace(/\/+$/, "");
  for (const path of writes) {
    if (path.startsWith(worktree) || path === worktree) continue; // inside worktree
    // Outside — must match a grant prefix.
    const granted = [...outsideGrants].some((prefix) => path.startsWith(prefix.replace(/\/+$/, "")));
    if (!granted) {
      return {
        allow: false,
        gate: "allowlist",
        reason: `write to ${path} is outside worktree (${worktree}) and not covered by an outside grant — block done`,
      };
    }
  }
  return { allow: true };
}

/**
 * Sanitize verify: for sanitize goals, done requires a tree-wide
 * DETECTED_SECRET_ probe that came back empty (no leftover masks).
 * `leftoverSecretMasks` already catches leftover masks; this gate catches
 * the case where no tree-wide probe ran at all.
 */
export function gateSanitizeVerify(goal: string, evidence: string): DoneGateVerdict {
  if (!askedToReplaceSecrets(goal)) return { allow: true };
  // Evidence must contain at least one tree-wide secret probe block.
  const blocks = evidence.split(/(?=^shell )/m);
  const hasTreeProbe = blocks.some((block) => isTreeWideSecretProbe(block));
  if (!hasTreeProbe) {
    return {
      allow: false,
      gate: "sanitize",
      reason: "sanitize goal done requires a tree-wide `grep -r DETECTED_SECRET_` (or rg/find equivalent) that comes back empty — none found in evidence",
    };
  }
  // If a tree probe ran, leftoverSecretMasks (in judgeReview) catches non-empty
  // results; here we only assert the probe exists.
  return { allow: true };
}

/**
 * Regex/test verify: for goals that ask for a regex or a test, done requires
 * evidence that the regex was run (matched/rejected) or the test command
 * was executed. "Written but not run" is not done for these classes.
 */
export function gateRegexTestVerify(
  goal: string,
  evidence: string,
  failClass?: string,
): DoneGateVerdict {
  const isRegexGoal = /\bregex\b|\bpattern\b|\bmatch(?:es|ed|ing)?\b/i.test(goal)
    || (failClass ? /\bsoft[-_]?regex\b/i.test(failClass) : false);
  const isTestGoal = /\btest\b|\bpytest\b|\bassert\b|\bspec\b/i.test(goal)
    || (failClass ? /\bsoft[-_]?test\b/i.test(failClass) : false);
  if (!isRegexGoal && !isTestGoal) return { allow: true };

  // Evidence must show a shell command that ran the regex or test.
  const hasRun = /\bshell\b.*\b(?:grep|rg|sed|pytest|python\s+-m\s+pytest|node\s+.*test|bun\s+test|jest|cargo\s+test|go\s+test)\b/i.test(evidence);
  // Or an explicit Check passed / matched line.
  const hasCheck = /\bCheck passed\b|\bmatched\b|\b\d+\s+tests?\b/i.test(evidence);
  if (!hasRun && !hasCheck) {
    return {
      allow: false,
      gate: "regex_test",
      reason: isRegexGoal
        ? "regex/pattern goal done requires evidence the regex was run (grep/sed/rg with match or reject) — none found"
        : "test goal done requires evidence the test command was executed (pytest/bun test/jest/etc.) — none found",
    };
  }
  return { allow: true };
}

/** Extract fs_write/shell-redirect target paths from evidence. */
function extractWritePaths(evidence: string): string[] {
  const paths: string[] = [];
  // fs_write {"path": "..."}
  for (const m of evidence.matchAll(/^fs_write\s+.*?"path"\s*:\s*"([^"]+)"/gm)) {
    paths.push(m[1] ?? "");
  }
  // shell redirect to a path: > /path or >> /path
  for (const m of evidence.matchAll(/(?:>>?|tee\s+)\s*(\/[^\s;|&]+)/g)) {
    paths.push(m[1] ?? "");
  }
  return paths.filter(Boolean);
}
