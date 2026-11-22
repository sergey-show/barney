/**
 * Kernel ablation: same model + tools, with or without Barney's loop law.
 * no-kernel keeps tools but disables recall and body learning for experience arms.
 *
 * Body write mode (matched-budget):
 *   gated     — policy + external admission (default)
 *   selfreport — pin on author claim (ablation control)
 */

import {
  parseBodyWriteMode,
  type BodyWriteMode,
  BODY_WRITE_MODE_ENV,
} from "../experience/bodyAdmission.ts";

export type KernelMode = "kernel" | "no-kernel";

export type KernelAblation = {
  mode: KernelMode;
  observeBlocks: boolean;
  structuralReview: boolean;
  wantingHalt: boolean;
  strategyForce: boolean;
  quarantineSkills: boolean;
  recallExperience: boolean;
  learnBody: boolean;
  /** How durable body pins are admitted. */
  bodyWriteMode: BodyWriteMode;
};

export const KERNEL_ABLATION_ENV = "BARNEY_ABLATION";

const FULL: KernelAblation = {
  mode: "kernel",
  observeBlocks: true,
  structuralReview: true,
  wantingHalt: true,
  strategyForce: true,
  quarantineSkills: true,
  recallExperience: true,
  learnBody: true,
  bodyWriteMode: "gated",
};

const ABLATED: KernelAblation = {
  mode: "no-kernel",
  observeBlocks: false,
  structuralReview: false,
  wantingHalt: false,
  strategyForce: false,
  quarantineSkills: false,
  recallExperience: false,
  learnBody: false,
  bodyWriteMode: "gated",
};

let override: KernelMode | null = null;
let writeModeOverride: BodyWriteMode | null = null;

export function setKernelAblationMode(mode: KernelMode | null): void {
  override = mode;
}

export function setBodyWriteModeOverride(mode: BodyWriteMode | null): void {
  writeModeOverride = mode;
}

export function parseKernelMode(raw: string | undefined | null): KernelMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "no-kernel" || value === "nokernel" || value === "ablated") return "no-kernel";
  return "kernel";
}

export function kernelAblationFor(
  mode: KernelMode,
  bodyWriteMode: BodyWriteMode = "gated",
): KernelAblation {
  if (mode === "no-kernel") return { ...ABLATED, bodyWriteMode };
  return { ...FULL, bodyWriteMode };
}

export function currentKernelAblation(env: NodeJS.ProcessEnv = process.env): KernelAblation {
  const mode = override ?? parseKernelMode(env[KERNEL_ABLATION_ENV]);
  const bodyWriteMode = writeModeOverride
    ?? parseBodyWriteMode(env[BODY_WRITE_MODE_ENV]);
  return kernelAblationFor(mode, bodyWriteMode);
}

export function ablationLabel(mode: KernelMode): string {
  return mode === "kernel" ? "full kernel" : "no-kernel (tools only)";
}
