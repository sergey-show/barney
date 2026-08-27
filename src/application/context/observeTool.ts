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
const TLS_CODES = /UNABLE_TO_VERIFY|ERR_CERT_|CERT_HAS_EXPIRED|SSL_ERROR_|DEPTH_ZERO_SELF_SIGNED|NET::ERR_CERT|curl: \((?:35|51|60)\)/i;
const NET_CODES = /ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|ERR_CONNECTION|ERR_TIMED_OUT|TimeoutError/i;
const AUTH_CODES = /\b401\b|\b403\b/;
const FULL_SECRET_TOKEN = /DETECTED_SECRET_[A-Z0-9]+_[A-F0-9]+/;
const SHELL_TALK =
  /(?:\.\.\.\s*wait|\bwait[,.!]|wait let's|\blet's just\b|\bthe user wants\b|\bbreak into small tool steps\b|\brun them now\b|\bi'll do step\b|\bno plan, no tools\b|\blet me break\b)/i;

function exitCode(text: string): number | null {
  const match = text.match(/^exit (\d+)(?:\n|$)/);
  return match ? Number(match[1]) : null;
}

function isFsTool(tool: string): boolean {
  return tool.startsWith("fs_");
}

export function classifyToolResult(out: string, tool = ""): { error: boolean; observe: string } {
  const text = out.slice(0, 2000);
  if (/^BLOCKED:/i.test(text)) return { error: true, observe: text.split("\n")[0] ?? text };
  if (/path escapes worktree/i.test(text)) {
    return {
      error: true,
      observe: "Path is outside the worktree. Use shell (cat >, tee, sed) for OS paths. Do not retry fs_* on that path.",
    };
  }
  if (/^opened |^showing /i.test(text)) return { error: false, observe: "" };
  if (/^web_search /i.test(text)) return { error: false, observe: "" };
  const code = exitCode(text);
  if (code === 0) return { error: false, observe: "" };
  if (isFsTool(tool)) {
    if (/^(error:|Error:)/m.test(text) || /command failed/i.test(text)) {
      return { error: true, observe: "Tool failed. Read the error, change tool or arguments, do not repeat this exact call." };
    }
    return { error: false, observe: "" };
  }
  if (TLS_CODES.test(text)) {
    return { error: true, observe: "TLS/certificate failed. Retry the same URL with shell. Do not invent another host." };
  }
  if (AUTH_CODES.test(text) || /unauthorized|authentication required|access denied/i.test(text)) {
    return { error: true, observe: "Auth failed. Use credentials already in this session on the same host. Do not ask again." };
  }
  if (NET_CODES.test(text)) {
    return { error: true, observe: "Host unreachable. Retry the same URL; do not invent another host." };
  }
  if (code != null && code !== 0) {
    return { error: true, observe: "Tool failed. Read the error, change tool or arguments, do not repeat this exact call." };
  }
  if (/^(error:|Error:)|Traceback|Exception\b|command failed/i.test(text)) {
    return { error: true, observe: "Tool failed. Read the error, change tool or arguments, do not repeat this exact call." };
  }
  return { error: false, observe: "" };
}

export function applyToolObserve(
  call: Pick<ToolCall, "name" | "arguments">,
  rawOut: string,
  failed: Set<string>,
  familyFails?: Map<string, number>,
  opts?: { leftoverUnwritten?: string[] },
): { out: string; skip: boolean } {
  if (call.name === "shell" && SHELL_TALK.test(String(call.arguments?.command ?? ""))) {
    const sig = toolSignature(call);
    failed.add(sig);
    return {
      skip: true,
      out: "error: command mixes shell with commentary.\n\nObserve: Put only the command in `command`. No plans, wait, or nudge text. Resend a clean one-liner.",
    };
  }
  const family = familyKey(call);
  const fsStillNeeded = isFsTool(call.name) && (opts?.leftoverUnwritten?.length ?? 0) > 0;
  if (familyFails && familySaturated(familyFails.get(family) ?? 0) && !FAMILY_EXEMPT.has(call.name) && !fsStillNeeded) {
    return {
      skip: true,
      out: `BLOCKED: wanting without liking in ${family}. Change tool family, not another ${call.name}.`,
    };
  }
  const sig = toolSignature(call);
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
    return { skip: false, out: withObserve(rawOut, redirectHint, secretGrepHint(call)) };
  }
  const grepHint = secretGrepHint(call);
  if (grepHint) return { skip: false, out: withObserve(rawOut, grepHint) };
  return { skip: false, out: rawOut };
}

function withObserve(raw: string, ...hints: Array<string | undefined>): string {
  const lines = hints.filter((hint): hint is string => Boolean(hint));
  if (!lines.length) return raw;
  return `${raw}\n\nObserve: ${lines.join(" ")}`;
}

function shellRedirectHint(call: Pick<ToolCall, "name" | "arguments">, fallback: string): string {
  if (call.name !== "shell") return fallback;
  const command = String(call.arguments?.command ?? "");
  if (!/(?:^|[\s;&|])(?:>{1,2})\s*\S+/.test(command)) return fallback;
  return "A redirect in this command may have written a file before the error. ls the target; do not retry this exact line.";
}

function secretGrepHint(call: Pick<ToolCall, "name" | "arguments">): string | undefined {
  if (call.name !== "shell") return;
  const command = String(call.arguments?.command ?? "");
  if (!/\bgrep\b/i.test(command) || !command.includes("DETECTED_SECRET")) return;
  if (FULL_SECRET_TOKEN.test(command)) return;
  return "Disk holds live secrets, not the mask string. Use the full DETECTED_SECRET_<KIND>_<HASH> in fs_edit, fs_search, or sed.";
}

function countsTowardFamily(out: string): boolean {
  return !/path escapes worktree/i.test(out);
}
