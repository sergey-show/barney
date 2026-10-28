/**
 * Tool output offload — keep a clipped view for the model, full body on disk.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_OFFLOAD_CHARS = 4_000;
export const HTML_OFFLOAD_CHARS = 2_200;

export type OffloadResult = {
  /** Text shown to the model (clipped + pointer). */
  forModel: string;
  /** Absolute path when full body was written; undefined if small enough. */
  fullPath?: string;
  truncated: boolean;
};

export function offloadToolOutput(input: {
  text: string;
  sessionPath: string;
  callId: string;
  tool: string;
  maxChars?: number;
}): OffloadResult {
  const max = input.maxChars ?? DEFAULT_OFFLOAD_CHARS;
  const raw = input.text ?? "";
  if (raw.length <= max) {
    return { forModel: raw, truncated: false };
  }
  const dir = join(input.sessionPath, ".barney", "tool-out");
  mkdirSync(dir, { recursive: true });
  const safeId = input.callId.replace(/[^\w.-]+/g, "_").slice(0, 48) || "out";
  const fullPath = join(dir, `${Date.now()}_${safeId}.txt`);
  writeFileSync(fullPath, raw, "utf8");
  const head = raw.slice(0, max);
  const forModel = [
    head,
    "",
    `[truncated ${raw.length - max} chars · full_output_path: ${fullPath}]`,
    `Re-read with fs_read path="${relHint(input.sessionPath, fullPath)}" if you need more.`,
  ].join("\n");
  return { forModel, fullPath, truncated: true };
}

function relHint(sessionPath: string, abs: string): string {
  if (abs.startsWith(sessionPath)) {
    const rel = abs.slice(sessionPath.length).replace(/^[/\\]+/, "");
    return rel || abs;
  }
  return abs;
}
