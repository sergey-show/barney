import { familyKey, familySaturated } from "./controlLoop.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export function toolSignature(call: Pick<ToolCall, "name" | "arguments">): string {
  const args = call.arguments ?? {};
  const bits = [call.name];
  for (const key of ["url", "path", "name", "selector", "command", "query"]) {
    const value = args[key];
    if (value == null || value === "") continue;
    bits.push(`${key}=${String(value).replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return bits.join("|").toLowerCase();
}

const FAMILY_EXEMPT = new Set(["browser_open", "web_search"]);
const FULL_SECRET_TOKEN = /DETECTED_SECRET_[A-Z0-9]+_[A-F0-9]+/;
/** File redirect (`> path`), not fd dup (`2>&1`). */
const FILE_REDIRECT = /(?:^|[\s;&|])(?:>{1,2}|tee)\s+(?!\d)(\S+)/;

function exitCode(text: string): number | null {
  const match = text.match(/^exit (\d+)(?:\n|$)/);
  return match ? Number(match[1]) : null;
}

function isFsTool(tool: string): boolean {
  return tool.startsWith("fs_");
}

/** Structural shape checks — not keyword commentary catalogs. */
function invalidShellCommand(command: string): string | undefined {
  if (/[\r\n]/.test(command)) return "command must be a single line";
  if (/`/.test(command)) return "command must not contain backticks";
  if (/\.\.\.\s+\S/.test(command)) return "command must not contain commentary after ...";
}

/**
 * Prefer exit codes and harness prefixes. Do not catalog error prose — the model reads stderr.
 */
export function classifyToolResult(out: string, tool = ""): { error: boolean; observe: string } {
  const text = out.slice(0, 2000);
  if (/^BLOCKED:/i.test(text)) return { error: true, observe: text.split("\n")[0] ?? text };
  if (/path escapes worktree/i.test(text)) {
    const permission = /permission required/i.test(text);
    return {
      error: true,
      observe: permission
        ? "Path is outside the worktree. Wait for the operator to /allow the prefix, or use shell (cat >, tee, sed). Do not retry the same fs_* call until allowed."
        : "Path is outside the worktree. Use shell (cat >, tee, sed) for OS paths. Do not retry fs_* on that path.",
    };
  }
  if (/^opened |^showing /i.test(text)) return { error: false, observe: "" };
  if (/^web_search /i.test(text)) return { error: false, observe: "" };
  const code = exitCode(text);
  if (code === 0) return { error: false, observe: "" };
  if (code != null && code !== 0) {
    return { error: true, observe: "Tool failed. Read the error, change tool or arguments, do not repeat this exact call." };
  }
  if (isFsTool(tool)) {
    if (/old text not found/i.test(text)) {
      return {
        error: true,
        observe:
          "old snippet not on disk (context/whitespace mismatch). fs_read the exact lines, then fs_edit with a unique snippet or fs_write the full file. Do not retry the same old.",
      };
    }
    if (/^(error:|Error:)/m.test(text)) {
      return { error: true, observe: "Tool failed. Read the error, change tool or arguments, do not repeat this exact call." };
    }
    return { error: false, observe: "" };
  }
  if (/^(error:|Error:)/m.test(text)) {
    return { error: true, observe: "Tool failed. Read the error, change tool or arguments, do not repeat this exact call." };
  }
  return { error: false, observe: "" };
}

export function applyToolObserve(
  call: Pick<ToolCall, "name" | "arguments">,
  rawOut: string,
  failed: Set<string>,
  familyFails?: Map<string, number>,
  opts?: {
    leftoverUnwritten?: string[];
    restorePaths?: string[];
    failedEditPaths?: string[];
    checkFailedPaths?: string[];
  },
): { out: string; skip: boolean } {
  const sig = toolSignature(call);
  if (call.name === "shell") {
    const shape = invalidShellCommand(String(call.arguments?.command ?? ""));
    if (shape) {
      failed.add(sig);
      return {
        skip: true,
        out: `error: ${shape}\n\nObserve: Put only the shell line in \`command\`. No plans or commentary. Resend a clean one-liner.`,
      };
    }
  }
  const family = familyKey(call);
  const stillLanding = (opts?.leftoverUnwritten?.length ?? 0) > 0;
  const landExempt = stillLanding && (isFsTool(call.name) || call.name === "shell");
  // Always allow fs_read through saturation — edits miss context without a re-read.
  const readExempt = call.name === "fs_read";
  if (
    familyFails
    && familySaturated(familyFails.get(family) ?? 0)
    && !FAMILY_EXEMPT.has(call.name)
    && !landExempt
    && !readExempt
  ) {
    return {
      skip: true,
      out: `BLOCKED: wanting without liking in ${family}. Change tool family, not another ${call.name}.`,
    };
  }
  if (failed.has(sig)) {
    const hint = classifyToolResult(rawOut, call.name).observe || "Change tool or arguments.";
    return {
      skip: true,
      out: `BLOCKED: exact same ${call.name} already failed. ${hint}`,
    };
  }
  const classified = classifyToolResult(rawOut, call.name);
  if (classified.error) {
    failed.add(sig);
    if (familyFails && countsTowardFamily(rawOut)) {
      familyFails.set(family, (familyFails.get(family) ?? 0) + 1);
    }
    const redirectHint = shellRedirectHint(call, classified.observe);
    return {
      skip: false,
      out: withObserve(
        rawOut,
        redirectHint,
        fsEditRecoveryHint(call, opts?.failedEditPaths, opts?.restorePaths),
        checkFailedHint(call, opts?.checkFailedPaths, opts?.restorePaths),
        secretGrepHint(call),
        restoreHint(call, opts?.restorePaths),
      ),
    };
  }
  const grepHint = secretGrepHint(call);
  const editHint = fsEditRecoveryHint(call, opts?.failedEditPaths, opts?.restorePaths);
  const checkHint = checkFailedHint(call, opts?.checkFailedPaths, opts?.restorePaths);
  if (grepHint || editHint || checkHint) return { skip: false, out: withObserve(rawOut, grepHint, editHint, checkHint) };
  return { skip: false, out: rawOut };
}

function withObserve(raw: string, ...hints: Array<string | undefined>): string {
  const lines = hints.filter((hint): hint is string => Boolean(hint?.trim()));
  if (!lines.length) return raw;
  const merged = lines.join(" ").replace(/\s+/g, " ").trim();
  const stripped = raw.replace(/\n\nObserve:[\s\S]*$/u, "").replace(/\nObserve:.*$/u, "");
  return `${stripped}\n\nObserve: ${merged}`;
}

/** One Observe line; replaces any prior Observe tail. */
export function attachObserve(raw: string, hint: string): string {
  return withObserve(raw, hint);
}

function shellRedirectHint(call: Pick<ToolCall, "name" | "arguments">, fallback: string): string {
  if (call.name !== "shell") return fallback;
  const command = String(call.arguments?.command ?? "");
  if (!FILE_REDIRECT.test(command)) return fallback;
  return "A redirect in this command may have written a file before the error. ls the target; do not retry this exact line.";
}

function secretGrepHint(call: Pick<ToolCall, "name" | "arguments">): string | undefined {
  if (call.name !== "shell") return;
  const command = String(call.arguments?.command ?? "");
  if (!/\bgrep\b/i.test(command) || !command.includes("DETECTED_SECRET")) return;
  if (FULL_SECRET_TOKEN.test(command)) return;
  return "Disk holds live secrets, not the mask string. Use the full DETECTED_SECRET_<KIND>_<HASH> in fs_edit, fs_search, or sed.";
}

/** Ledger says a check failed on these paths — only when this call touches them. */
function checkFailedHint(
  call: Pick<ToolCall, "name" | "arguments">,
  checkFailed?: string[],
  restorePaths?: string[],
): string | undefined {
  if (!checkFailed?.length) return;
  if (call.name === "shell") {
    const command = String(call.arguments?.command ?? "");
    const hit = checkFailed.find((path) => commandIncludesPath(command, path));
    if (!hit) return;
    const restore = restorePaths?.find((p) => pathEquals(hit, p));
    const undo = restore ? `fs_restore ${restore} or ` : "";
    return `Check failed on ${hit} — use ${undo}a minimal fix; do not chain more patches on the same broken file.`;
  }
  if (call.name === "fs_write" || call.name === "fs_edit" || call.name === "fs_append") {
    const path = String(call.arguments?.path ?? "");
    const hit = checkFailed.find((p) => pathEquals(path, p));
    if (!hit) return;
    const restore = restorePaths?.find((p) => pathEquals(hit, p));
    const undo = restore ? `fs_restore ${restore} or ` : "";
    return `Prior check failed on this path — use ${undo}a minimal fix; do not rewrite blindly.`;
  }
}

function pathEquals(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a);
}

/** Ledger says fs_edit failed on this path — no parsing of error prose. */
function fsEditRecoveryHint(
  call: Pick<ToolCall, "name" | "arguments">,
  failedEditPaths?: string[],
  restorePaths?: string[],
): string | undefined {
  if (call.name !== "fs_edit" || !failedEditPaths?.length) return;
  const path = String(call.arguments?.path ?? "");
  if (!path || !failedEditPaths.some((p) => path === p || path.endsWith(p) || p.endsWith(path))) return;
  const restore = restorePaths?.find((p) => path === p || path.endsWith(p) || p.endsWith(path));
  const undo = restore ? `fs_restore ${restore} or ` : "";
  return `fs_edit failed on this path — use ${undo}fs_write the full file; do not retry the same old snippet.`;
}

function restoreHint(call: Pick<ToolCall, "name" | "arguments">, restorePaths?: string[]): string | undefined {
  if (!restorePaths?.length) return;
  if (call.name === "shell") {
    const command = String(call.arguments?.command ?? "");
    const hit = restorePaths.find((path) => commandIncludesPath(command, path));
    if (hit) return `If this run failed because the file is broken, fs_restore ${hit} brings back the last good session version.`;
    return;
  }
  if (call.name === "fs_write" || call.name === "fs_edit" || call.name === "fs_append") {
    const path = String(call.arguments?.path ?? "");
    const hit = restorePaths.find((p) => path === p || path.endsWith(p) || p.endsWith(path));
    if (hit) return `fs_restore ${hit} is available if you need the last good version.`;
  }
}

function commandIncludesPath(command: string, path: string): boolean {
  if (!path) return false;
  if (command.includes(path)) return true;
  const base = path.split("/").filter(Boolean).at(-1);
  return Boolean(base && command.includes(base));
}

function countsTowardFamily(out: string): boolean {
  // Context-miss edits and jail escapes are redirects, not "wanting without liking".
  if (/path escapes worktree/i.test(out)) return false;
  if (/old text not found/i.test(out)) return false;
  return true;
}
