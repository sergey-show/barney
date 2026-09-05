/**
 * Operational Self: immune lines that code can enforce (not only prompt text).
 */

const KERNEL_TOUCH = /(?:src\/(?:domain|application|composition|infrastructure)|Kernel\.ts|DriveSolve\.ts)/i;

export type SelfGateResult = {
  blocked: boolean;
  reason?: string;
  principle?: string;
};

/** Hard blocks from immune constitution — physical, not advisory. */
export function selfGateTool(input: {
  toolName: string;
  args?: Record<string, unknown>;
  constitution?: string;
}): SelfGateResult {
  const name = input.toolName;
  const path = String(input.args?.path ?? input.args?.file ?? "");
  const command = String(input.args?.command ?? "");
  const blob = `${path}\n${command}`;

  if ((name === "fs_write" || name === "fs_edit" || name === "fs_append") && KERNEL_TOUCH.test(path)) {
    return {
      blocked: true,
      principle: "kernel immutable",
      reason: "BLOCKED by Self: kernel sources are immune — edit body/skills/plugins, not the kernel.",
    };
  }
  if (name === "shell" && /(?:\brm\b|\bmv\b|\btee\b|\bsed\s+-i).*(?:src\/(?:domain|application|composition)|Kernel\.ts)/i.test(command)) {
    return {
      blocked: true,
      principle: "kernel immutable",
      reason: "BLOCKED by Self: shell must not rewrite kernel sources.",
    };
  }
  if (/do not write secrets to memory/i.test(input.constitution ?? "") && name.startsWith("memory_") && /DETECTED_SECRET_|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]|hf_[A-Za-z0-9]/i.test(blob)) {
    return {
      blocked: true,
      principle: "no secrets in memory",
      reason: "BLOCKED by Self: do not write secrets to memory.",
    };
  }
  return { blocked: false };
}

/** Soft metric: did the act text contradict a Never / immune line? */
export function selfViolationNote(constitution: string, actText: string): string | undefined {
  const nevers = extractNeverLines(constitution);
  for (const line of nevers) {
    if (/kernel/i.test(line) && /rewrote (?:the )?kernel|changed the kernel|patch(?:ed)? the kernel/i.test(actText)) {
      return `Self violation: ${line}`;
    }
    if (/program of the self|write a program of the self/i.test(line) && /rewrote (?:my )?constitution|reprogrammed (?:the )?self/i.test(actText)) {
      return `Self violation: ${line}`;
    }
  }
}

export function extractNeverLines(constitution: string): string[] {
  const lines: string[] = [];
  for (const raw of constitution.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:never|#\s*never|do not|the kernel is immutable)/i.test(line)) lines.push(line.replace(/^#\s*/, ""));
  }
  return lines.slice(0, 8);
}

export function immuneBoundaryNote(constitution: string): string {
  const nevers = extractNeverLines(constitution);
  if (!nevers.length) {
    return "Immune: do not change the kernel; do not write a program of the self; do not store secrets in memory.";
  }
  return `Immune (code-enforced where possible):\n${nevers.map((l) => `- ${l}`).join("\n")}`;
}
