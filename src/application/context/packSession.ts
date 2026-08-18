import type { ChatMessage } from "../../domain/provider/Role.ts";
import { peelUntaggedThinking } from "../../infrastructure/llm/visibleReply.ts";

export type TranscriptLike = { kind: string; text: string };

export type PackedSession = {
  digest: string;
  recent: ChatMessage[];
  folded: number;
  anchors: string[];
};

const RECENT_COUNT = 14;
const MAX_RECENT_CHARS = 12_000;
const MAX_DIGEST_CHARS = 4_000;
const MAX_TURN = { user: 400, assistant: 500, console: 280 };
const MAX_RECENT = { user: 1_500, assistant: 2_000, console: 1_200 };

export function packSession(transcript: TranscriptLike[], goal: string): PackedSession {
  const durable = transcript.filter((item) => item.kind === "user" || item.kind === "assistant" || item.kind === "console");
  const recentItems = durable.slice(-RECENT_COUNT);
  const older = durable.slice(0, Math.max(0, durable.length - recentItems.length));
  const anchors = extractAnchors(goal, ...transcript.map((item) => item.text));
  const head = [
    `Goal: ${clipText(goal, 400)}`,
    anchors.length ? `Pinned facts (copy exactly, never truncate or guess):\n${anchors.map((a) => `- ${a}`).join("\n")}` : "",
    artifactsLine(transcript),
    lastToolsLine(recentItems),
  ].filter(Boolean).join("\n");
  const folded = older.length
    ? `Earlier turns (${older.length} items compressed):\n${foldTurns(older)}`
    : "";
  const room = Math.max(400, MAX_DIGEST_CHARS - head.length);
  const digest = [head, clipText(folded, room)].filter(Boolean).join("\n");
  const recent = budgetClip(
    recentItems.map((item) => toRecentMessage(item)),
    MAX_RECENT_CHARS,
  );
  return { digest, recent, folded: older.length, anchors };
}

function toRecentMessage(item: TranscriptLike): ChatMessage {
  if (item.kind === "user") {
    return { role: "user", content: clipText(stripThink(item.text), MAX_RECENT.user) };
  }
  if (item.kind === "assistant") {
    return { role: "assistant", content: clipText(stripThink(item.text), MAX_RECENT.assistant) };
  }
  return { role: "user", content: `Tool output:\n${clipText(item.text, MAX_RECENT.console)}` };
}

function foldTurns(items: TranscriptLike[]): string {
  const lines: string[] = [];
  let pending: { user: string; result: string; tools: string[] } | null = null;
  const flush = () => {
    if (!pending) return;
    const tools = pending.tools.length ? `\n  Tools: ${pending.tools.join("; ")}` : "";
    lines.push(`- User: ${pending.user}\n  Result: ${pending.result}${tools}`);
    pending = null;
  };
  for (const item of items) {
    if (item.kind === "user") {
      flush();
      pending = { user: clipText(stripThink(item.text), MAX_TURN.user), result: "(no reply yet)", tools: [] };
      continue;
    }
    if (item.kind === "assistant") {
      const text = clipText(stripThink(item.text), MAX_TURN.assistant);
      if (pending) pending.result = text;
      else lines.push(`- Result: ${text}`);
      continue;
    }
    if (item.kind === "console") {
      const tool = clipText(consoleHead(item.text), MAX_TURN.console);
      if (pending) pending.tools.push(tool);
      else lines.push(`- Tool: ${tool}`);
    }
  }
  flush();
  return lines.join("\n");
}

function consoleHead(text: string): string {
  const first = text.split("\n").find((line) => line.trim()) ?? text;
  return first.replace(/\s+/g, " ").trim().slice(0, 180);
}

function lastToolsLine(recent: TranscriptLike[]): string {
  const tools = recent.filter((item) => item.kind === "console").slice(-4).map((item) => consoleHead(item.text));
  return tools.length ? `Recent tool output (full text is in the chat as Tool output):\n${tools.map((line) => `- ${line}`).join("\n")}` : "";
}

function artifactsLine(transcript: TranscriptLike[]): string {
  const files = new Set<string>();
  const plugins = new Set<string>();
  for (const item of transcript) {
    if (item.kind !== "console") continue;
    const head = item.text.slice(0, 400);
    if (head.startsWith("fs_write") || head.startsWith("fs_edit") || head.startsWith("fs_append")) {
      const path = head.match(/"path"\s*:\s*"([^"]+)"/)?.[1];
      if (path) files.add(path);
    }
    const plugin = head.match(/saved plugin:([a-z0-9-]+)/i)?.[1]
      ?? head.match(/plugin_write[\s\S]{0,120}"name"\s*:\s*"([a-z0-9-]+)"/)?.[1];
    if (plugin) plugins.add(plugin);
  }
  const parts = [
    plugins.size ? `plugins: ${[...plugins].join(", ")}` : "",
    files.size ? `files: ${[...files].join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? `Artifacts: ${parts.join("; ")}` : "";
}

function budgetClip(messages: ChatMessage[], maxTotal: number): ChatMessage[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= maxTotal || !messages.length) return messages;
  const cap = Math.max(360, Math.floor(maxTotal / messages.length));
  return messages.map((message) => ({ ...message, content: clipText(message.content, cap) }));
}

export function stripThink(text: string): string {
  const tagged = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```thinking[\s\S]*?```/gi, "");
  return peelUntaggedThinking(tagged).text.replace(/\s+/g, " ").trim();
}

export function clipText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact || compact.length <= max) return compact;
  const head = `${compact.slice(0, Math.max(1, max - 1))}…`;
  const missing = extractAnchors(compact).filter((anchor) => !head.includes(anchor));
  return missing.length ? `${head}\n${missing.join(" ")}` : head;
}

export function extractAnchors(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    for (const raw of part.match(/https?:\/\/[^\s<>"'`)\]}]+/gi) ?? []) {
      const url = raw.replace(/[.,;]+$/g, "");
      if (isDurableUrl(url)) found.add(url);
    }
    for (const ip of part.match(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g) ?? []) {
      found.add(ip);
    }
  }
  return [...found];
}

export function redactSecrets(text: string): string {
  return text.replace(
    /(пароль|password|passwd|secret|api[_-]?key)\s*[:=]?\s*\S+/gi,
    "$1 [redacted]",
  );
}

function isDurableUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/\.$/, "");
    if (!host.includes(".")) return false;
    if (/^\d+$/.test(host) || /^\d+\.\d+$/.test(host) || /^\d+\.\d+\.\d+$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}
