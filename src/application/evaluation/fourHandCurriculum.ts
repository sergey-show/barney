/**
 * Four-hand curriculum: separates loop law from experience causality.
 *
 * Causal claim for experience:
 *   transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)
 *
 * Hard cases underspecify house conventions on the test arm so fresh must
 * invent tokens/canon; train wrote them into body/memory only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ExperienceArm = "kernel-train" | "kernel-test" | "no-kernel" | "kernel-fresh";

export type HardTransferCase = {
  id: string;
  title: string;
  family: string;
  trainGoals: string[];
  testGoal: string;
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
  transferSuccessLift: number;
  kernelLift: number;
};

export type ExperienceMetrics = {
  transferSuccessLift: number;
  recallHitRate: number;
  recallUsedRate: number;
  skillReuseRate: number;
  falseSkillRate: number;
};

/** House tokens — taught in train goals only; never written into test fixtures. */
export const HOUSE_REDACT = {
  aws: "<barney-redact-aws>",
  github: "<barney-redact-github>",
  slack: "<barney-redact-slack>",
} as const;

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

function liveSecretLeft(text: string): boolean {
  return /AKIA[0-9A-Z]{8,}|ghp_[A-Za-z0-9]{8,}|xoxb-[A-Za-z0-9-]{8,}/.test(text);
}

/** Hard suite: house conventions live in memory after train, not in test files. */
export const HARD_TRANSFER_CASES: HardTransferCase[] = [
  {
    id: "house-redact",
    title: "Train explicit house tokens → test only says 'house redaction'",
    family: "sanitize",
    trainGoals: [
      [
        "In `.env`, replace AWS_ACCESS_KEY_ID with exactly `<barney-redact-aws>`",
        "and GITHUB_TOKEN with exactly `<barney-redact-github>`.",
        "Keep APP_NAME and REGION. Do not use `<your-…>` placeholders.",
        "These two strings are the Barney house redaction tokens — remember them.",
      ].join(" "),
    ],
    testGoal: [
      "Sanitize `.env`: remove live AWS, GitHub, and Slack secrets.",
      "Use Barney house redaction tokens (the ones learned for this instance) for aws, github, and slack.",
      "Keep APP_NAME=demo and REGION=eu-central-1.",
      "Write `audit.txt` with exactly `aws=1\\ngithub=1\\nslack=1\\n` and no live secret material.",
      "Do not invent `<your-…>` tokens.",
    ].join(" "),
    whyHard: "Test never spells house tokens; fresh invents <your-…> or REDACTED and fails.",
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
          "AWS_ACCESS_KEY_ID=AKIATESTEXAMPLE99ZZ",
          "GITHUB_TOKEN=ghp_testExampleToken9999xx",
          "SLACK_BOT_TOKEN=xoxb-test-example-token-99",
          "",
        ].join("\n"),
      );
    },
    verifyTrain: (worktree) => {
      const env = read(worktree, ".env") ?? "";
      const ok = env.includes(HOUSE_REDACT.aws)
        && env.includes(HOUSE_REDACT.github)
        && env.includes("APP_NAME=demo")
        && !liveSecretLeft(env)
        && !/<your-/.test(env);
      return { ok, detail: ok ? "train house redact ok" : "train missing house tokens or live secret left" };
    },
    verifyTest: (worktree) => {
      const env = read(worktree, ".env") ?? "";
      const audit = read(worktree, "audit.txt") ?? "";
      const tokens = env.includes(HOUSE_REDACT.aws)
        && env.includes(HOUSE_REDACT.github)
        && env.includes(HOUSE_REDACT.slack)
        && env.includes("APP_NAME=demo")
        && env.includes("REGION=eu-central-1")
        && !liveSecretLeft(env)
        && !/<your-/.test(env);
      const auditOk = audit === "aws=1\ngithub=1\nslack=1\n" && !liveSecretLeft(audit);
      const ok = tokens && auditOk;
      return {
        ok,
        detail: ok
          ? "house redact+audit ok"
          : `tokens=${tokens} audit=${auditOk} env=${JSON.stringify(env).slice(0, 160)}`,
      };
    },
  },
  {
    id: "house-merge",
    title: "Train explicit JSON canon → test only says 'house canon'",
    family: "merge",
    trainGoals: [
      [
        "Deep-merge base.json and patch.json into merged.json (patch wins; arrays replace).",
        "House JSON canon: 2-space indent, keys sorted at every level, trailing newline.",
        "Exact bytes required. Remember this canon.",
      ].join(" "),
    ],
    testGoal: [
      "Deep-merge base.json and patch.json into merged.json (patch wins; arrays replace).",
      "Serialize with the Barney house JSON canon learned for this instance.",
      "Exact bytes required — do not emit compact or unsorted JSON.",
    ].join(" "),
    whyHard: "Test omits indent/sort/newline details; fresh often writes non-canonical JSON.",
    setupTrain: (worktree) => {
      write(worktree, "base.json", `${JSON.stringify({ a: 1, nested: { x: 1, y: 2 }, list: [1] }, null, 2)}\n`);
      write(worktree, "patch.json", `${JSON.stringify({ nested: { y: 9 }, list: [2, 3], b: true }, null, 2)}\n`);
    },
    setupTest: (worktree) => {
      write(
        worktree,
        "base.json",
        `${JSON.stringify({ zebra: 1, alpha: { c: 3, a: 1 }, list: ["keep"] }, null, 2)}\n`,
      );
      write(
        worktree,
        "patch.json",
        `${JSON.stringify({ alpha: { b: 2 }, list: ["replace"], beta: 0 }, null, 2)}\n`,
      );
    },
    verifyTrain: (worktree) => {
      const raw = read(worktree, "merged.json");
      if (raw == null) return { ok: false, detail: "missing merged.json" };
      const expected = canonicalJson({ a: 1, nested: { x: 1, y: 9 }, list: [2, 3], b: true });
      const ok = raw === expected;
      return { ok, detail: ok ? "train house merge ok" : "train bytes not canonical" };
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
        detail: ok ? "house merge ok" : `bytes mismatch got=${JSON.stringify(raw).slice(0, 120)}`,
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
