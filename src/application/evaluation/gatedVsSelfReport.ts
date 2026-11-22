/**
 * Matched-budget ablation: gated body writes vs self-report pins.
 * Same cases, same provider budget envelope — only admission mode differs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BodyWriteMode } from "../experience/bodyAdmission.ts";
import { runFourHandCurriculum, type FourHandReport } from "./fourHandRunner.ts";
import { setBodyWriteModeOverride } from "./kernelAblation.ts";

export type GatedVsSelfReportOptions = {
  caseIds?: string[];
  outDir?: string;
  scratch?: string;
  providerHost?: string;
  providerModel?: string;
  providerName?: string;
  providerDialect?: string;
};

export type GatedVsSelfReportReport = {
  at: string;
  gated: FourHandReport;
  selfreport: FourHandReport;
  /** gated.meanLift − selfreport.meanLift (positive ⇒ admission helps). */
  liftDelta: number;
  verdict: "gated_helps" | "selfreport_helps" | "tie" | "inconclusive";
};

export async function runGatedVsSelfReport(
  opts: GatedVsSelfReportOptions = {},
): Promise<GatedVsSelfReportReport> {
  const gated = await runArm("gated", opts);
  const selfreport = await runArm("selfreport", opts);
  const liftDelta = gated.metrics.transferSuccessLift - selfreport.metrics.transferSuccessLift;
  const report: GatedVsSelfReportReport = {
    at: new Date().toISOString(),
    gated,
    selfreport,
    liftDelta,
    verdict: verdictOf(liftDelta, gated.cases.length),
  };
  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, "gated-vs-selfreport.json"), JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

async function runArm(
  mode: BodyWriteMode,
  opts: GatedVsSelfReportOptions,
): Promise<FourHandReport> {
  setBodyWriteModeOverride(mode);
  try {
    const outDir = opts.outDir ? join(opts.outDir, mode) : undefined;
    return await runFourHandCurriculum({
      caseIds: opts.caseIds,
      outDir,
      scratch: opts.scratch ? join(opts.scratch, mode) : undefined,
      providerHost: opts.providerHost,
      providerModel: opts.providerModel,
      providerName: opts.providerName,
      providerDialect: opts.providerDialect,
    });
  } finally {
    setBodyWriteModeOverride(null);
  }
}

function verdictOf(delta: number, n: number): GatedVsSelfReportReport["verdict"] {
  if (n < 1) return "inconclusive";
  if (Math.abs(delta) < 1e-9) return "tie";
  return delta > 0 ? "gated_helps" : "selfreport_helps";
}

export function formatGatedVsSelfReport(report: GatedVsSelfReportReport): string {
  return [
    `gated-vs-selfreport · ${report.at}`,
    `verdict: ${report.verdict}`,
    `lift_delta (gated − selfreport): ${report.liftDelta.toFixed(2)}`,
    `gated_lift: ${report.gated.metrics.transferSuccessLift.toFixed(2)} · ${report.gated.verdict}`,
    `selfreport_lift: ${report.selfreport.metrics.transferSuccessLift.toFixed(2)} · ${report.selfreport.verdict}`,
  ].join("\n");
}
