import { familySaturated, toolFamily } from "./controlLoop.ts";
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

const FAMILY_EXEMPT = new Set(["browser_open", "web_search", "shell"]);
const TLS_CODES = /UNABLE_TO_VERIFY|ERR_CERT_|CERT_HAS_EXPIRED|SSL_ERROR_|DEPTH_ZERO_SELF_SIGNED|NET::ERR_CERT|curl: \((?:35|51|60)\)/i;
const NET_CODES = /ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|ERR_CONNECTION|ERR_TIMED_OUT|TimeoutError/i;
const AUTH_CODES = /\b401\b|\b403\b/;

function exitCode(text: string): number | null {
  const match = text.match(/^exit (\d+)(?:\n|$)/);
  return match ? Number(match[1]) : null;
}

export function classifyToolResult(out: string): { error: boolean; observe: string } {
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
): { out: string; skip: boolean } {
  const family = toolFamily(call.name);
  if (familyFails && familySaturated(familyFails.get(family) ?? 0) && !FAMILY_EXEMPT.has(call.name)) {
    return {
      skip: true,
      out: `BLOCKED: wanting without liking in ${family}. Change tool family, not another ${call.name}.`,
    };
  }
  const sig = toolSignature(call);
  if (failed.has(sig)) {
    const hint = classifyToolResult(rawOut).observe || "Change tool or arguments.";
    return {
      skip: true,
      out: `BLOCKED: exact same ${call.name} already failed. ${hint}`,
    };
  }
  const classified = classifyToolResult(rawOut);
  if (classified.error) {
    failed.add(sig);
    if (familyFails && countsTowardFamily(rawOut)) {
      familyFails.set(family, (familyFails.get(family) ?? 0) + 1);
    }
    return { skip: false, out: `${rawOut}\n\nObserve: ${classified.observe}` };
  }
  return { skip: false, out: rawOut };
}

function countsTowardFamily(out: string): boolean {
  return !/path escapes worktree/i.test(out);
}
