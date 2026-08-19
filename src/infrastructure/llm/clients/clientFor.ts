import type { ChatMessage, ChatResult, Role } from "../../../domain/provider/Role.ts";
import type { LlmProvider } from "../../../domain/provider/LlmProvider.ts";
import type { ToolCall, ToolSpec } from "../../../domain/tools/FileTools.ts";
import { extractReasoning } from "../thinkParse.ts";
import { openaiChatClient, type LlmClient } from "./openaiChat.ts";
import { schemaFor } from "./schema.ts";

export function clientFor(provider: LlmProvider): LlmClient {
  const schema = schemaFor(provider);
  if (schema.transport === "stub") return stubClient();
  if (schema.transport === "anthropic-messages") return anthropicClient(provider);
  return openaiChatClient(provider, schema);
}

function stubClient(): LlmClient {
  return {
    complete: async ({ role, messages, tools }) => stubComplete(role, messages, tools),
    listModels: async () => ["stub"],
  };
}

function anthropicClient(provider: LlmProvider): LlmClient {
  return {
    complete: ({ model, messages, tools, signal, onThinking }) =>
      anthropicComplete(provider, model, messages, tools, signal, onThinking),
    listModels: async () => ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  };
}

function toAnthropicMessages(messages: ChatMessage[]) {
  const out: Array<{ role: string; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out.at(-1);
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const call of m.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function anthropicComplete(
  provider: LlmProvider,
  model: string,
  messages: ChatMessage[],
  tools?: ToolSpec[],
  signal?: AbortSignal,
  onThinking?: (delta: string) => void,
): Promise<ChatResult> {
  if (!provider.apiKey) throw new Error("anthropic provider needs an api key");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const body: Record<string, unknown> = {
    model,
    max_tokens: 2048,
    system,
    messages: toAnthropicMessages(messages),
  };
  if (tools?.length) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  const res = await fetch(provider.baseUrl || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    content: Array<{ type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = json.content.filter((c) => c.type === "text" || (c.text && c.type !== "thinking")).map((c) => c.text ?? "").join("");
  const thinking = json.content.filter((c) => c.type === "thinking" && c.thinking).map((c) => c.thinking ?? "").join("\n\n");
  const split = extractReasoning({ content: text, thinking }, { peelUntagged: false, tagsInContent: true });
  if (split.thinking) onThinking?.(split.thinking);
  const toolCalls: ToolCall[] = json.content
    .filter((c) => c.type === "tool_use" && c.id && c.name)
    .map((c) => ({ id: c.id!, name: c.name!, arguments: c.input ?? {} }));
  const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
  return { text: split.text, thinking: split.thinking || undefined, tokens, usd: tokens * 0.000003, toolCalls };
}

function stubToolCall(last: string): ToolCall | null {
  if (/time|date/i.test(last)) {
    const command = process.platform === "win32" ? "echo %DATE% %TIME%" : "date";
    return { id: "stub-date", name: "shell", arguments: { command } };
  }
  if (/write|create|save/i.test(last)) {
    const path = last.match(/[\w./\\-]+\.\w{1,12}/)?.[0] ?? "notes.md";
    return { id: "stub-write", name: "fs_write", arguments: { path, content: last.slice(0, 800) } };
  }
  if (/mkdir|folder|directory/i.test(last) && /create|make|new/i.test(last)) {
    return { id: "stub-mkdir", name: "fs_mkdir", arguments: { path: "work" } };
  }
  if (/search|find|grep/i.test(last)) {
    return { id: "stub-search", name: "fs_search", arguments: { query: last.slice(0, 40), path: "." } };
  }
  if (/read|open|show|cat/i.test(last)) {
    const path = last.match(/[\w./\\-]+\.\w{1,12}/)?.[0];
    if (path) return { id: "stub-read", name: "fs_read", arguments: { path } };
  }
  if (/list|ls|dir|files|tree|inspect|worktree/i.test(last)) {
    return { id: "stub-list", name: "fs_list", arguments: { path: "." } };
  }
  return { id: "stub-list", name: "fs_list", arguments: { path: "." } };
}

export function stubComplete(role: Role, messages: ChatMessage[], tools?: ToolSpec[]): ChatResult {
  const last = messages.at(-1)?.content ?? "";
  if (role === "reviewer") {
    const uncertain = /api|docs|unknown|context7|library/i.test(last);
    const weak = /workaround|metadata|mtime|cannot|available|first cut|aligned/i.test(last);
    const verdict = uncertain ? "unknown_api" : weak ? "fail" : "pass";
    return {
      text: JSON.stringify({
        verdict,
        achieved: verdict === "pass",
        requested: "the user's latest request",
        missing: verdict === "pass" ? "" : "The reply does not clearly deliver what the user asked for.",
        summary: uncertain
          ? "Need canonical docs before treating this as done."
          : weak
            ? "The agent did not deliver the requested result; a workaround or incomplete answer is not enough."
            : "The requested result appears to be present.",
        needsResearch: uncertain,
        knowledgeQuery: uncertain ? last.slice(0, 160) : "",
      }),
      tokens: 80,
      usd: 0,
    };
  }
  if (tools?.length && !messages.some((m) => m.role === "tool")) {
    const userText = messages.filter((m) => m.role === "user").at(-1)?.content ?? last;
    const call = stubToolCall(userText);
    if (call) return { text: "", toolCalls: [call], tokens: 40, usd: 0 };
  }
  const toolNotes = messages.filter((m) => m.role === "tool").map((m) => `${m.name ?? "tool"}:\n${m.content}`).join("\n\n");
  return {
    text: toolNotes
      ? `[${role}] Worktree result:\n${toolNotes.slice(0, 900)}\n\nNext: apply a small change if needed, then wait for review.`
      : `[${role}] Working the task.\n\n${last.slice(0, 400)}\n\nNext: inspect the worktree, apply a small change, then wait for review.`,
    tokens: 120,
    usd: 0,
  };
}
