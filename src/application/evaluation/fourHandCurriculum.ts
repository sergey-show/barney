/**
 * Four-hand curriculum: separates loop law from experience causality.
 *
 * Arms:
 * - kernel-train → writes body on sterile home
 * - kernel-test  → same home (with train experience)
 * - no-kernel    → tools only, no body
 * - kernel-fresh → full kernel, empty body (control)
 *
 * Causal claim for experience:
 *   transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ExperienceArm = "kernel-train" | "kernel-test" | "no-kernel" | "kernel-fresh";

export type HardTransferCase = {
  id: string;
  title: string;
  family: string;
  /** 1–N train goals in the same family (kernel-train only). */
  trainGoals: string[];
  /** Shifted test goal — must be harder / different invariant than train. */
  testGoal: string;
  /** Why no-kernel / fresh should struggle without train lessons. */
  whyHard: string;
  setupTrain?: (worktree: string) => void;
  setupTest: (worktree: string) => void;
  verifyTrain?: (worktree: string) => { ok: boolean; detail: string };
  verifyTest: (worktree: string) => { ok: boolean; detail: string };
};

export type ArmResult = {
  arm: ExperienceArm;
  ok: boolean;
  detail: string;
  attempts: number;
  recallHit?: boolean;
  recallUsed?: boolean;
  recallHelped?: boolean | null;
  markerHits?: number;
};

export type FourHandCaseResult = {
  caseId: string;
  arms: ArmResult[];
  /** Causal experience lift (needs kernel-test and kernel-fresh). */
  transferSuccessLift: number;
  /** Loop-law contrast (kernel-fresh vs no-kernel) on the same test. */
  kernelLift: number;
};

export type ExperienceMetrics = {
  transferSuccessLift: number;
  recallHitRate: number;
  recallUsedRate: number;
  skillReuseRate: number;
  falseSkillRate: number;
};

function write(worktree: string, rel: string, body: string): void {
  const path = join(worktree, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

function read(worktree: string, rel: string): string | null {
  const path = join(worktree, rel);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeysDeep(obj[key]);
    return out;
  }
  return value;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === "object" && base && typeof base === "object" && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, val] of Object.entries(patch as Record<string, unknown>)) {
      out[key] = key in out ? deepMerge(out[key], val) : val;
    }
    return out;
  }
  return patch;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/** Seed hard suite — extend until no-kernel/fresh fail more than kernel-test. */
export const HARD_TRANSFER_CASES: HardTransferCase[] = [
  {
    id: "sanitize-shifted",
    title: "Sanitize train → shifted secret formats + audit",
    family: "sanitize",
    trainGoals: [
      "In `.env`, replace AWS_ACCESS_KEY_ID with `<your-aws-access-key-id>` and GITHUB_TOKEN with `<your-github-token>`. Keep APP_NAME and REGION.",
    ],
    testGoal: [
      "In `.env`, replace three live secrets with exact placeholders",
      "`<your-aws-access-key-id>`, `<your-github-token>`, `<your-slack-bot-token>`.",
      "Also write `audit.txt` with exactly `aws=1\\ngithub=1\\nslack=1\\n` and no live secret material.",
      "Keep APP_NAME=demo and REGION=eu-central-1.",
    ].join(" "),
    whyHard: "Test adds Slack + leak-free audit; wrong placeholders fail the verifier.",
    setupTrain: (worktree) => {
      write(
        worktree,
        ".env",
        [
          "APP_NAME=demo",
          "REGION=eu-central-1",
          "AWS_ACCESS_KEY_ID=AKIATRAINEXAMPLE01",
          "GITHUB_TOKEN=ghp_trainExampleToken0001",
          "",
        ].join("\n"),
      );
    },
    setupTest: (worktree) => {
      write(
        worktree,
        ".env",
        [
          "APP_NAME=demo",
          "REGION=eu-central-1",
          "AWS_ACCESS_KEY_ID=AKIATESTEXAMPLE99",
          "GITHUB_TOKEN=ghp_testExampleToken9999",
          "SLACK_BOT_TOKEN=xoxb-test-example-token",
          "",
        ].join("\n"),
      );
    },
    verifyTrain: (worktree) => {
      const env = read(worktree, ".env") ?? "";
      const ok = env.includes("<your-aws-access-key-id>")
        && env.includes("<your-github-token>")
        && env.includes("APP_NAME=demo")
        && !/AKIA|ghp_/.test(env);
      return { ok, detail: ok ? "train sanitize ok" : "train secrets remain or placeholders wrong" };
    },
    verifyTest: (worktree) => {
      const env = read(worktree, ".env") ?? "";
      const audit = read(worktree, "audit.txt") ?? "";
      const placeholders = env.includes("<your-aws-access-key-id>")
        && env.includes("<your-github-token>")
        && env.includes("<your-slack-bot-token>")
        && env.includes("APP_NAME=demo")
        && env.includes("REGION=eu-central-1")
        && !/AKIA|ghp_|xoxb-/.test(env);
      const auditOk = audit === "aws=1\ngithub=1\nslack=1\n" && !/AKIA|ghp_|xoxb-/.test(audit);
      const ok = placeholders && auditOk;
      return {
        ok,
        detail: ok
          ? "sanitize+audit ok"
          : `ph=${placeholders} audit=${auditOk} env_len=${env.length} audit=${JSON.stringify(audit)}`,
      };
    },
  },
  {
    id: "merge-shifted",
    title: "Deep-merge train → canonical bytes test",
    family: "merge",
    trainGoals: [
      "Deep-merge base.json and patch.json into merged.json (patch wins; arrays replace).",
    ],
    testGoal: [
      "Deep-merge base.json and patch.json into merged.json with canonical form:",
      "2-space indent, keys sorted at every level, trailing newline. Exact bytes required.",
    ].join(" "),
    whyHard: "Train teaches semantics; test requires byte-exact serialization.",
    setupTrain: (worktree) => {
      write(worktree, "base.json", JSON.stringify({ a: 1, nested: { x: 1, y: 2 }, list: [1] }, null, 2) + "\n");
      write(worktree, "patch.json", JSON.stringify({ nested: { y: 9 }, list: [2, 3], b: true }, null, 2) + "\n");
    },
    setupTest: (worktree) => {
      write(
        worktree,
        "base.json",
        JSON.stringify({ zebra: 1, alpha: { c: 3, a: 1 }, list: ["keep"] }, null, 2) + "\n",
      );
      write(
        worktree,
        "patch.json",
        JSON.stringify({ alpha: { b: 2 }, list: ["replace"], beta: 0 }, null, 2) + "\n",
      );
    },
    verifyTrain: (worktree) => {
      const raw = read(worktree, "merged.json");
      if (!raw) return { ok: false, detail: "missing merged.json" };
      try {
        const got = JSON.parse(raw);
        const expected = { a: 1, nested: { x: 1, y: 9 }, list: [2, 3], b: true };
        const ok = JSON.stringify(got) === JSON.stringify(expected)
          || JSON.stringify(sortKeysDeep(got)) === JSON.stringify(sortKeysDeep(expected));
        return { ok, detail: ok ? "train merge ok" : `got=${JSON.stringify(got)}` };
      } catch (err) {
        return { ok: false, detail: String(err) };
      }
    },
    verifyTest: (worktree) => {
      const raw = read(worktree, "merged.json");
      if (raw == null) return { ok: false, detail: "missing merged.json" };
      const expectedObj = deepMerge(
        { zebra: 1, alpha: { c: 3, a: 1 }, list: ["keep"] },
        { alpha: { b: 2 }, list: ["replace"], beta: 0 },
      );
      const expected = canonicalJson(expectedObj);
      const ok = raw === expected;
      return {
        ok,
        detail: ok ? "canonical merge ok" : `bytes mismatch expected=${JSON.stringify(expected)} got=${JSON.stringify(raw)}`,
      };
    },
  },
];

export function transferSuccessLift(arms: ArmResult[]): number {
  const withTrain = arms.find((arm) => arm.arm === "kernel-test");
  const fresh = arms.find((arm) => arm.arm === "kernel-fresh");
  if (!withTrain || !fresh) return 0;
  return Number(withTrain.ok) - Number(fresh.ok);
}

export function kernelLiftOnTest(arms: ArmResult[]): number {
  const fresh = arms.find((arm) => arm.arm === "kernel-fresh");
  const naked = arms.find((arm) => arm.arm === "no-kernel");
  if (!fresh || !naked) return 0;
  return Number(fresh.ok) - Number(naked.ok);
}

export function summarizeExperienceMetrics(cases: FourHandCaseResult[]): ExperienceMetrics {
  const n = cases.length || 1;
  const testArms = cases.flatMap((item) => item.arms.filter((arm) => arm.arm === "kernel-test"));
  const hit = testArms.filter((arm) => arm.recallHit).length;
  const used = testArms.filter((arm) => arm.recallUsed).length;
  return {
    transferSuccessLift: cases.reduce((sum, item) => sum + item.transferSuccessLift, 0) / n,
    recallHitRate: testArms.length ? hit / testArms.length : 0,
    recallUsedRate: testArms.length ? used / testArms.length : 0,
    skillReuseRate: 0,
    falseSkillRate: 0,
  };
}

export function hardTransferCaseById(id: string): HardTransferCase | undefined {
  return HARD_TRANSFER_CASES.find((item) => item.id === id);
}
