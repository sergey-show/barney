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

const LOOKUP = new Set(["browser_open", "web_search"]);

export function classifyToolResult(out: string): { error: boolean; observe: string } {
  const text = out.slice(0, 2000);
  if (/^BLOCKED:/i.test(text)) return { error: true, observe: text.split("\n")[0] ?? text };
  if (/^opened |^showing /i.test(text)) return { error: false, observe: "" };
  if (/^web_search /i.test(text)) return { error: false, observe: "" };
  if (/ssl|tls|certificate|self[- ]signed|CERT_|UNABLE_TO_VERIFY|ERR_CERT/i.test(text)) {
    return { error: true, observe: "TLS/certificate failed. Retry the same URL with shell. Do not invent another host." };
  }
  if (/\b401\b|\b403\b|unauthorized|authentication required|access denied/i.test(text)) {
    return { error: true, observe: "Auth failed. Use credentials already in this session on the same host. Do not ask again." };
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|ERR_CONNECTION|ERR_TIMED_OUT|connection timed out|request timed out|TimeoutError/i.test(text)) {
    return { error: true, observe: "Host unreachable. Retry the same URL; do not invent another host." };
  }
  if (/^(error:|Error:)|Traceback|Exception\b|command failed|exit code [1-9]/i.test(text)) {
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
  if (familyFails && familySaturated(familyFails.get(family) ?? 0) && !LOOKUP.has(call.name)) {
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
    if (familyFails) familyFails.set(family, (familyFails.get(family) ?? 0) + 1);
    return { skip: false, out: `${rawOut}\n\nObserve: ${classified.observe}` };
  }
  return { skip: false, out: rawOut };
}
