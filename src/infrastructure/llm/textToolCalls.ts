import type { ToolCall } from "../../domain/tools/FileTools.ts";

const NAME = /[a-z][a-z0-9_]{1,40}/;

const TOOL_ALIAS: Record<string, string> = {
  skill_list: "plugin_list",
  skill_write: "plugin_write",
  skill_open: "plugin_open",
  skill_read: "plugin_read",
};

function aliasTool(name: string): string {
  return TOOL_ALIAS[name] ?? name;
}

export function extractToolCallsFromText(text: string, allowed?: Set<string>): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  const push = (name: string, args: Record<string, unknown>) => {
    const tool = aliasTool(name.trim());
    if (!NAME.test(tool)) return;
    if (allowed && !allowed.has(tool)) return;
    const key = `${tool}:${JSON.stringify(args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ id: `text_${calls.length}`, name: tool, arguments: args });
  };

  for (const match of text.matchAll(/<tool_call>\s*([\s\S]*?)<\/tool_call>/gi)) {
    parseToolBody(match[1] ?? "", push);
  }
  for (const match of text.matchAll(/<function(?:=|\s+name=)["']?([a-z0-9_]+)["']?>([\s\S]*?)<\/function>/gi)) {
    push(match[1] ?? "", parseParamXml(match[2] ?? ""));
  }
  for (const match of text.matchAll(/<action>\s*([a-z0-9_]+)\s*<\/action>([\s\S]{0,800})/gi)) {
    const name = match[1] ?? "";
    const tail = match[2] ?? "";
    const args = parseParamXml(tail);
    Object.assign(args, parseKeyValues(tail));
    const json = tail.match(/\{[\s\S]*\}/);
    if (json) Object.assign(args, parseJson(json[0]));
    push(name, args);
  }
  if (!calls.length) {
    const jsonBlock = text.match(/```(?:json|tool[_\s-]?call)?\s*(\{[\s\S]*?"name"\s*:\s*"[a-z0-9_]+"[\s\S]*?\})\s*```/i);
    if (jsonBlock) parseToolBody(jsonBlock[1] ?? "", push);
  }
  return calls;
}

export function stripToolMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<function(?:=|\s+name=)[^>]*>[\s\S]*?<\/function>/gi, "")
    .replace(/<action>\s*[a-z0-9_]+\s*<\/action>/gi, "")
    .replace(/<\/?(?:path|content|name|task|agent|title|body|query|command|args|description|skills|url|key|tags)>\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hydrateTextTools(
  text: string,
  allowed: Set<string>,
  fallback?: { task?: string },
): { calls: ToolCall[]; visible: string } {
  const calls = extractToolCallsFromText(text, allowed).map((call) => fillRequired(call, fallback?.task));
  if (calls.length === 1 && calls[0]?.name === "agent_spawn" && str(calls[0].arguments.task)) {
    calls.push({
      id: "text_delegate",
      name: "agent_delegate",
      arguments: { agent: calls[0].arguments.name, task: calls[0].arguments.task },
    });
  }
  return { calls, visible: stripToolMarkup(text) };
}

function fillRequired(call: ToolCall, task?: string): ToolCall {
  const args = { ...call.arguments };
  if (call.name === "agent_spawn") {
    if (!str(args.name)) args.name = "researcher";
    if (!str(args.task) && task) args.task = task;
  }
  if (call.name === "agent_delegate") {
    if (!str(args.agent)) args.agent = "researcher";
    if (!str(args.task) && task) args.task = task;
  }
  return { ...call, arguments: args };
}

function parseToolBody(body: string, push: (name: string, args: Record<string, unknown>) => void): void {
  const trimmed = body.trim();
  const json = parseJson(trimmed);
  if (json && typeof json.name === "string") {
    const args = json.arguments && typeof json.arguments === "object" && !Array.isArray(json.arguments)
      ? json.arguments as Record<string, unknown>
      : {};
    push(json.name, args);
    return;
  }
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const name = (lines[0] ?? "").replace(/^[\s`*-]+/, "");
  const args = parseKeyValues(lines.slice(1).join("\n"));
  if (NAME.test(name)) push(name, args);
}

function parseParamXml(xml: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const match of xml.matchAll(/<parameter(?:=|\s+name=)["']?([a-z0-9_]+)["']?>([\s\S]*?)<\/parameter>/gi)) {
    args[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  for (const match of xml.matchAll(/<([a-z][a-z0-9_]*)>([\s\S]*?)<\/\1>/gi)) {
    const key = match[1] ?? "";
    if (key === "action" || key === "tool_call" || key === "function") continue;
    args[key] = (match[2] ?? "").trim();
  }
  return args;
}

function parseKeyValues(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([a-z][a-z0-9_]*)\s*(?:=|is|:)\s*(.+)$/i);
    if (match) args[match[1] ?? ""] = match[2]?.trim() ?? "";
  }
  return args;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
