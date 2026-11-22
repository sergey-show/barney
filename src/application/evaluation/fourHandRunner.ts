/**
 * Four-hand runner: kernel-train → kernel-test → no-kernel → kernel-fresh.
 * Causal experience claim: transfer_success_lift = kernel-test − kernel-fresh.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../../composition/Kernel.ts";
import type { TranscriptItem } from "../../domain/run/Run.ts";
import {
  HARD_TRANSFER_CASES,
  hardTransferCaseById,
  kernelLiftOnTest,
  summarizeExperienceMetrics,
  transferSuccessLift,
  type ArmResult,
  type ExperienceArm,
  type FourHandCaseResult,
  type HardTransferCase,
} from "./fourHandCurriculum.ts";
import {
  sampleExperienceCases,
  type CaseWeightHint,
} from "./experienceCurriculumSample.ts";
import { seedVerifiedTransferSkill } from "./seedTransferSkill.ts";
import { setKernelAblationMode, type KernelMode } from "./kernelAblation.ts";
import {
  buildSpacedAnchors,
  dueSpacedDelays,
  markDelayDone,
  planSpacedProbes,
  summarizeSpacedRetention,
  type SpacedAnchor,
  type SpacedLiftObservation,
  type SpacedProbePlan,
  type SpacedRetentionReport,
} from "./spacedTransfer.ts";

export type FourHandRunOptions = {
  caseIds?: string[];
  /** Failure-weighted hints (recent fails / low lift → sample more). */
  curriculumHints?: CaseWeightHint[];
  /** Override how many cases to sample (default: all, weight-sorted). */
  sampleCount?: number;
  sampleSeed?: number;
  outDir?: string;
  scratch?: string;
  providerHost?: string;
  providerModel?: string;
  providerName?: string;
  providerDialect?: string;
};

type ProviderSeed = {
  name: string;
  host: string;
  model: string;
  dialect: string;
};

export type FourHandReport = {
  at: string;
  cases: FourHandCaseResult[];
  metrics: ReturnType<typeof summarizeExperienceMetrics>;
  verdict: "experience_helps" | "no_lift" | "experience_hurts" | "inconclusive";
  /** Retention schedule (immediate / +1d / +7d); only delay=0 is measured in this run. */
  spacedPlan: SpacedProbePlan[];
  spacedRetention: SpacedRetentionReport[];
  /** Persisted train homes for later +1d/+7d retests. */
  spacedAnchors: SpacedAnchor[];
};

export async function runFourHandCurriculum(opts: FourHandRunOptions = {}): Promise<FourHandReport> {
  const cases = selectCases(opts);
  const scratch = opts.scratch ?? mkdtempSync(join(tmpdir(), "barney-fourhand-"));
  mkdirSync(scratch, { recursive: true });
  const provider = resolveProvider(opts);
  const results: FourHandCaseResult[] = [];
  const trainHomes: Array<{ caseId: string; trainHome: string; transferSuccessLift: number }> = [];

  for (const item of cases) {
    console.error(`four-hand · ${item.id} · start`);
    const { arms, trainHome } = await runCase(item, scratch, provider);
    const transfer = transferSuccessLift(arms);
    const kernel = kernelLiftOnTest(arms);
    results.push({
      caseId: item.id,
      arms,
      transferSuccessLift: transfer,
      kernelLift: kernel,
    });
    trainHomes.push({ caseId: item.id, trainHome, transferSuccessLift: transfer });
    console.error(
      `four-hand · ${item.id} · lift=${transfer} kernelLift=${kernel} · ${arms.map((a) => `${a.arm}:${a.ok ? "PASS" : "FAIL"}`).join(" ")}`,
    );
  }

  const metrics = summarizeExperienceMetrics(results);
  const spacedPlan = planSpacedProbes();
  const at = new Date().toISOString();
  const spacedAnchors = buildSpacedAnchors({ cases: trainHomes, trainedAt: at });
  const spacedRetention = results.map((item) =>
    summarizeSpacedRetention(item.caseId, [
      {
        caseId: item.caseId,
        delayHours: 0,
        transferSuccessLift: item.transferSuccessLift,
      },
    ]),
  );
  const report: FourHandReport = {
    at,
    cases: results,
    metrics,
    verdict: verdictOf(metrics.transferSuccessLift, results.length),
    spacedPlan,
    spacedRetention,
    spacedAnchors,
  };
  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, "fourhand-report.json"), JSON.stringify(report, null, 2), "utf8");
    writeFileSync(join(opts.outDir, "spaced-anchors.json"), JSON.stringify(spacedAnchors, null, 2), "utf8");
    for (const item of results) {
      writeFileSync(join(opts.outDir, `${item.caseId}.json`), JSON.stringify(item, null, 2), "utf8");
    }
  }
  return report;
}

function selectCases(opts: FourHandRunOptions): HardTransferCase[] {
  if (opts.curriculumHints?.length || opts.sampleCount != null || opts.sampleSeed != null) {
    return sampleExperienceCases({
      caseIds: opts.caseIds,
      hints: opts.curriculumHints,
      count: opts.sampleCount,
      seed: opts.sampleSeed,
    }).map((row) => row.case);
  }
  if (!opts.caseIds?.length) return HARD_TRANSFER_CASES;
  return opts.caseIds.map((id) => {
    const found = hardTransferCaseById(id);
    if (!found) throw new Error(`unknown hard transfer case: ${id}`);
    return found;
  });
}

function resolveProvider(opts: FourHandRunOptions): ProviderSeed {
  return {
    name: opts.providerName ?? process.env.BARNEY_ABLATION_PROVIDER ?? "ollama-local",
    host: opts.providerHost ?? process.env.BARNEY_ABLATION_HOST ?? "http://127.0.0.1:11434/v1",
    model: opts.providerModel ?? process.env.BARNEY_ABLATION_MODEL ?? "qwen3.8:latest",
    dialect: opts.providerDialect ?? process.env.BARNEY_ABLATION_DIALECT ?? "ollama",
  };
}

async function runCase(
  item: HardTransferCase,
  scratch: string,
  provider: ProviderSeed,
): Promise<{ arms: ArmResult[]; trainHome: string }> {
  const arms: ArmResult[] = [];
  const homeTrain = mkdtempSync(join(scratch, `${item.id}-train-home-`));
  setKernelAblationMode("kernel");
  const kernel = new Kernel(homeTrain);
  try {
    await bootWithProvider(kernel, provider);
    for (const [i, goal] of item.trainGoals.entries()) {
      const wt = mkdtempSync(join(scratch, `${item.id}-train-${i}-wt-`));
      item.setupTrain?.(wt);
      const trainRun = await kernel.createRun(goal, undefined, wt);
      await kernel.send(trainRun.id.value, goal);
      const trainOk = item.verifyTrain?.(wt);
      console.error(`  train[${i}] ${trainOk?.ok ? "PASS" : "fail"} ${trainOk?.detail ?? ""}`);
    }
    if (item.skillSeed) {
      const seeded = await seedVerifiedTransferSkill(kernel, item.skillSeed);
      console.error(`  skill-seed ${seeded.name} status=${seeded.status}`);
    }
    const testWt = mkdtempSync(join(scratch, `${item.id}-kernel-test-wt-`));
    item.setupTest(testWt);
    const testRun = await kernel.createRun(item.testGoal, undefined, testWt);
    const done = await kernel.send(testRun.id.value, item.testGoal);
    arms.push(scoreArm("kernel-test", item, testWt, done));
    arms.unshift({
      arm: "kernel-train",
      ok: true,
      detail: `trained ${item.trainGoals.length} goal(s) on ${homeTrain}`,
      attempts: 0,
    });
  } catch (err) {
    arms.push(crashArm("kernel-train", err));
    arms.push(crashArm("kernel-test", err));
  } finally {
    setKernelAblationMode(null);
  }

  arms.push(await runFreshArm("no-kernel", item, scratch, provider));
  arms.push(await runFreshArm("kernel-fresh", item, scratch, provider));
  return { arms: annotateCausalHelp(arms), trainHome: homeTrain };
}

/**
 * Re-probe a persisted train home at a spaced delay: kernel-test on trained body
 * vs kernel-fresh (empty body). Matched to the same case verify.
 */
export async function runSpacedAnchorRetest(input: {
  anchors: SpacedAnchor[];
  observations?: SpacedLiftObservation[];
  delayHours?: number;
  now?: Date;
  scratch?: string;
  outDir?: string;
  providerHost?: string;
  providerModel?: string;
  providerName?: string;
  providerDialect?: string;
}): Promise<{
  observations: SpacedLiftObservation[];
  anchors: SpacedAnchor[];
  reports: SpacedRetentionReport[];
}> {
  const provider = resolveProvider(input);
  const scratch = input.scratch ?? mkdtempSync(join(tmpdir(), "barney-spaced-"));
  mkdirSync(scratch, { recursive: true });
  const observations = [...(input.observations ?? [])];
  const updated: SpacedAnchor[] = [];

  for (const anchor of input.anchors) {
    const item = hardTransferCaseById(anchor.caseId);
    if (!item) {
      updated.push(anchor);
      continue;
    }
    const delays = dueSpacedDelays(anchor, input.now ?? new Date(), input.delayHours);
    let next = anchor;
    if (!observations.some((o) => o.caseId === anchor.caseId && o.delayHours === 0)) {
      observations.push({
        caseId: anchor.caseId,
        delayHours: 0,
        transferSuccessLift: anchor.immediateLift,
      });
    }
    for (const delay of delays) {
      console.error(`spaced-retest · ${anchor.caseId} · +${delay}h · home=${anchor.trainHome}`);
      const testWt = mkdtempSync(join(scratch, `${anchor.caseId}-d${delay}-test-wt-`));
      item.setupTest(testWt);
      setKernelAblationMode("kernel");
      const trained = new Kernel(anchor.trainHome);
      let testOk = false;
      try {
        await bootWithProvider(trained, provider);
        const run = await trained.createRun(item.testGoal, undefined, testWt);
        const done = await trained.send(run.id.value, item.testGoal);
        testOk = scoreArm("kernel-test", item, testWt, done).ok;
      } catch (err) {
        console.error(`  trained arm crash: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setKernelAblationMode(null);
      }
      const fresh = await runFreshArm("kernel-fresh", item, scratch, provider);
      const lift = Number(testOk) - Number(fresh.ok);
      observations.push({ caseId: anchor.caseId, delayHours: delay, transferSuccessLift: lift });
      next = markDelayDone(next, delay);
      console.error(`  lift=${lift} trained=${testOk ? "PASS" : "FAIL"} fresh=${fresh.ok ? "PASS" : "FAIL"}`);
    }
    updated.push(next);
  }

  const ids = [...new Set(updated.map((a) => a.caseId))];
  const reports = ids.map((id) => summarizeSpacedRetention(id, observations));
  if (input.outDir) {
    mkdirSync(input.outDir, { recursive: true });
    writeFileSync(join(input.outDir, "spaced-observations.json"), JSON.stringify(observations, null, 2), "utf8");
    writeFileSync(join(input.outDir, "spaced-anchors.json"), JSON.stringify(updated, null, 2), "utf8");
    writeFileSync(join(input.outDir, "spaced-retention.json"), JSON.stringify(reports, null, 2), "utf8");
  }
  return { observations, anchors: updated, reports };
}

/** fayr: recall_helped is causal — kernel-test pass with used recall while fresh fails. */
function annotateCausalHelp(arms: ArmResult[]): ArmResult[] {
  const test = arms.find((arm) => arm.arm === "kernel-test");
  const fresh = arms.find((arm) => arm.arm === "kernel-fresh");
  if (!test || !fresh) return arms;
  const helped = Boolean(test.ok && !fresh.ok && test.recallUsed);
  return arms.map((arm) => {
    if (arm.arm !== "kernel-test") {
      return arm.arm === "kernel-fresh" || arm.arm === "no-kernel"
        ? { ...arm, recallHelped: arm.recallHit && arm.recallUsed === false ? false : null }
        : arm;
    }
    return { ...arm, recallHelped: helped };
  });
}

async function runFreshArm(
  arm: "no-kernel" | "kernel-fresh",
  item: HardTransferCase,
  scratch: string,
  provider: ProviderSeed,
): Promise<ArmResult> {
  const mode: KernelMode = arm === "no-kernel" ? "no-kernel" : "kernel";
  const home = mkdtempSync(join(scratch, `${item.id}-${arm}-home-`));
  const wt = mkdtempSync(join(scratch, `${item.id}-${arm}-wt-`));
  item.setupTest(wt);
  setKernelAblationMode(mode);
  const kernel = new Kernel(home);
  try {
    await bootWithProvider(kernel, provider);
    const created = await kernel.createRun(item.testGoal, undefined, wt);
    const done = await kernel.send(created.id.value, item.testGoal);
    return scoreArm(arm, item, wt, done);
  } catch (err) {
    return crashArm(arm, err);
  } finally {
    setKernelAblationMode(null);
  }
}

async function bootWithProvider(kernel: Kernel, provider: ProviderSeed): Promise<void> {
  await kernel.boot();
  await kernel.addOpenAiProvider({
    name: provider.name,
    host: provider.host,
    dialect: provider.dialect,
  });
  await kernel.useProvider(provider.name, provider.model);
}

function scoreArm(
  arm: ExperienceArm,
  item: HardTransferCase,
  worktree: string,
  done: { attempts: number; transcript: TranscriptItem[] },
): ArmResult {
  const verified = item.verifyTest(worktree);
  const recall = parseRecallSignals(done.transcript);
  return {
    arm,
    ok: verified.ok,
    detail: verified.detail,
    attempts: done.attempts,
    recallHit: recall.hit,
    recallUsed: recall.used,
    recallHelped: recall.helped,
    skillReused: recall.skillReused,
    skillFalse: recall.skillFalse,
  };
}

function crashArm(arm: ExperienceArm, err: unknown): ArmResult {
  return {
    arm,
    ok: false,
    detail: `crash: ${err instanceof Error ? err.message : String(err)}`,
    attempts: 0,
  };
}

export function parseRecallSignals(transcript: TranscriptItem[]): {
  hit: boolean;
  used: boolean;
  helped: boolean | null;
  skillReused: boolean;
  skillFalse: boolean;
} {
  let hit = false;
  let used = false;
  let helped: boolean | null = null;
  let skillReused = false;
  let skillFalse = false;
  for (const item of transcript) {
    if (item.kind !== "system") continue;
    const line = item.text;
    if (/skill_reuse:\s*1/.test(line)) skillReused = true;
    if (/skill_false:\s*1/.test(line)) skillFalse = true;
    if (!/recall_hit:/.test(line)) continue;
    hit = /recall_hit:\s*1/.test(line) || hit;
    used = /recall_used:\s*1/.test(line) || used;
    if (/recall_helped:\s*1/.test(line)) helped = true;
    else if (/recall_helped:\s*0/.test(line) && helped !== true) helped = false;
  }
  return { hit, used, helped, skillReused, skillFalse };
}

function verdictOf(lift: number, n: number): FourHandReport["verdict"] {
  if (n < 1) return "inconclusive";
  if (lift > 0) return "experience_helps";
  if (lift < 0) return "experience_hurts";
  return "no_lift";
}

export function formatFourHandReport(report: FourHandReport): string {
  const lines = [
    `four-hand experience · ${report.at}`,
    `verdict: ${report.verdict}`,
    `transfer_success_lift: ${report.metrics.transferSuccessLift.toFixed(2)}`,
    `recall_hit_rate: ${report.metrics.recallHitRate.toFixed(2)}`,
    `recall_used_rate: ${report.metrics.recallUsedRate.toFixed(2)}`,
    `skill_reuse_rate: ${report.metrics.skillReuseRate.toFixed(2)}`,
    `false_skill_rate: ${report.metrics.falseSkillRate.toFixed(2)}`,
    `spaced_plan: ${report.spacedPlan.map((p) => p.label).join(" → ")}`,
    "",
  ];
  for (const item of report.cases) {
    lines.push(`## ${item.caseId} · lift=${item.transferSuccessLift} kernelLift=${item.kernelLift}`);
    for (const arm of item.arms) {
      const recall = arm.recallHit == null
        ? ""
        : ` · recall hit=${Number(arm.recallHit)} used=${Number(arm.recallUsed ?? 0)} helped=${arm.recallHelped == null ? "?" : Number(arm.recallHelped)}`;
      const skill = arm.skillReused || arm.skillFalse
        ? ` · skill reuse=${Number(Boolean(arm.skillReused))} false=${Number(Boolean(arm.skillFalse))}`
        : "";
      lines.push(`  ${arm.arm.padEnd(14)} ${arm.ok ? "PASS" : "FAIL"} · ${arm.detail}${recall}${skill}`);
    }
    const spaced = report.spacedRetention.find((row) => row.caseId === item.caseId);
    const anchor = report.spacedAnchors.find((row) => row.caseId === item.caseId);
    if (spaced) {
      lines.push(
        `  spaced: immediate_lift=${spaced.probes[0]?.transferSuccessLift ?? "?"}`
          + ` · anchors due +1d/+7d → barney eval spaced-retest --anchors <spaced-anchors.json>`,
      );
    }
    if (anchor) lines.push(`  train_home: ${anchor.trainHome}`);
    lines.push("");
  }
  return lines.join("\n");
}
