/**
 * Kernel ablation: same model + tools, with or without Barney's loop law.
 * no-kernel keeps tools but disables recall and body learning for experience arms.
 */

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
};

let override: KernelMode | null = null;

export function setKernelAblationMode(mode: KernelMode | null): void {
  override = mode;
}

export function parseKernelMode(raw: string | undefined | null): KernelMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "no-kernel" || value === "nokernel" || value === "ablated") return "no-kernel";
  return "kernel";
}

export function kernelAblationFor(mode: KernelMode): KernelAblation {
  return mode === "no-kernel" ? { ...ABLATED } : { ...FULL };
}

export function currentKernelAblation(env: NodeJS.ProcessEnv = process.env): KernelAblation {
  const mode = override ?? parseKernelMode(env[KERNEL_ABLATION_ENV]);
  return kernelAblationFor(mode);
}

export function ablationLabel(mode: KernelMode): string {
  return mode === "kernel" ? "full kernel" : "no-kernel (tools only)";
}
