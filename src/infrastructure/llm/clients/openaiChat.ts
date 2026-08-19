import type { ChatMessage, ChatResult, CompleteOptions, Role } from "../../../domain/provider/Role.ts";
import type { LlmProvider } from "../../../domain/provider/LlmProvider.ts";
import type { ToolCall, ToolSpec } from "../../../domain/tools/FileTools.ts";
import { generationLooped, trimLooped } from "../generationLoop.ts";
import { hydrateTextTools, stripToolMarkup } from "../textToolCalls.ts";
import { extractReasoning, ThinkStreamFilter } from "../thinkParse.ts";
import { requestBodyExtras, type DialectSchema } from "./schema.ts";

export type LlmClient = {
  complete(input: {
    role: Role;
    model: string;
    messages: ChatMessage[];
    tools?: ToolSpec[];
    toolChoice?: CompleteOptions["toolChoice"];
    signal?: AbortSignal;
    onThinking?: (delta: string) => void;
  }): Promise<ChatResult>;
  listModels(): Promise<string[]>;
};

export function openaiChatClient(provider: LlmProvider, schema: DialectSchema): LlmClient {
  return {
    complete: (input) => openAiCompatComplete(
      provider,
      schema,
      input.model,
      input.messages,
      input.tools,
      input.signal,
      input.onThinking,
      input.toolChoice,
    ),
    listModels: () => listOpenAiModels(provider),
  };
}

export function parseModelIds(json: unknown): string[] {
  if (Array.isArray(json)) {
    return json.map((item) => (typeof item === "string" ? item : String((item as { id?: string }).id ?? ""))).filter(Boolean);
  }
  if (json && typeof json === "object") {
    const data = (json as { data?: unknown; models?: unknown }).data ?? (json as { models?: unknown }).models;
    if (Array.isArray(data)) {
      return data.map((item) => {
        if (typeof item === "string") return item;
        const row = item as { id?: string; name?: string; model?: string };
        return String(row.id || row.name || row.model || "");
      }).filter(Boolean);
    }
  }
  return [];
}

export async function listOpenAiModels(provider: LlmProvider): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  const res = await fetch(`${provider.baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`models ${res.status}: ${await res.text()}`);
  return parseModelIds(await res.json());
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { _raw: raw };
  } catch {
    return { _raw: raw };
  }
}

function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      if (m.images?.length) {
        out.push({
          role: "user",
          content: [
            { type: "text", text: `Look at this screenshot from ${m.name ?? "the browser"}.` },
            ...m.images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ],
        });
      }
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      });
      continue;
    }
    if (m.images?.length) {
      out.push({
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
          })),
        ],
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toOpenAiTools(tools: ToolSpec[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

type OpenAiMessage = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  thinking?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  function_call?: { name: string; arguments: string };
};

type OpenAiCompletion = {
  choices?: Array<{
    message?: OpenAiMessage;
    delta?: OpenAiDelta;
    finish_reason?: string | null;
  }>;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
};

function usageTokens(usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | null): number {
  if (!usage) return 0;
  if (usage.total_tokens) return usage.total_tokens;
  return (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
}

type OpenAiDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  thinking?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  function_call?: { name?: string; arguments?: string };
};

async function openAiCompatComplete(
  provider: LlmProvider,
  schema: DialectSchema,
  model: string,
  messages: ChatMessage[],
  tools?: ToolSpec[],
  signal?: AbortSignal,
  onThinking?: (delta: string) => void,
  toolChoice?: "auto" | "required",
): Promise<ChatResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(messages),
    ...requestBodyExtras(schema),
  };
  if (tools?.length) {
    body.tools = toOpenAiTools(tools);
    if (toolChoice === "required") body.tool_choice = "required";
  }

  const streamed = await openAiCompatStream(provider, schema, headers, body, signal, onThinking);
  if (streamed.ok) return withTextTools(streamed.result, tools, messages);
  if (tools?.length && /tool_choice/i.test(streamed.error) && toolChoice === "required") {
    return openAiCompatComplete(provider, schema, model, messages, tools, signal, onThinking, "auto");
  }
  if (tools?.length && /tool|function|jinja|template|system message/i.test(streamed.error)) {
    return openAiCompatComplete(provider, schema, model, messages, undefined, signal, onThinking);
  }
  if (streamed.canFallback) {
    return withTextTools(await openAiCompatNonStream(provider, schema, headers, body, signal, onThinking, tools), tools, messages);
  }
  throw new Error(streamed.error);
}

async function openAiCompatNonStream(
  provider: LlmProvider,
  schema: DialectSchema,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onThinking: ((delta: string) => void) | undefined,
  tools?: ToolSpec[],
): Promise<ChatResult> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    if (tools?.length && /tool|function|jinja|template|system message/i.test(errText)) {
      const retry = { ...body };
      delete retry.tools;
      return openAiCompatNonStream(provider, schema, headers, retry, signal, onThinking);
    }
    throw new Error(`llm ${res.status}: ${errText}`);
  }
  return withTextTools(resultFromCompletion((await res.json()) as OpenAiCompletion, schema, onThinking), tools, undefined);
}

async function openAiCompatStream(
  provider: LlmProvider,
  schema: DialectSchema,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onThinking?: (delta: string) => void,
): Promise<{ ok: true; result: ChatResult } | { ok: false; error: string; canFallback: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { ok: false, error: String(err), canFallback: true };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `llm ${res.status}: ${errText}`, canFallback: true };
  }
  if (!res.body) return { ok: false, error: "llm stream: empty body", canFallback: true };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const think = new ThinkStreamFilter(onThinking, {
    peelUntagged: schema.think.peelUntagged,
    tagsInContent: schema.think.tagsInContent,
  });
  const toolsAcc: Array<{ id: string; name: string; arguments: string }> = [];
  let reasoning = "";
  let generated = "";
  let looped = false;
  let tokens = 0;
  let buf = "";
  let mode: "unknown" | "sse" | "json" = "unknown";
  let sawEvent = false;

  const applyDelta = (delta: OpenAiDelta | undefined) => {
    if (!delta || looped) return;
    const extra = schema.think.fields
      .map((field) => delta[field])
      .filter((value): value is string => Boolean(value))
      .join("");
    if (extra) {
      reasoning += extra;
      onThinking?.(extra);
      if (generationLooped(reasoning)) looped = true;
    }
    if (delta.content) {
      think.push(delta.content);
      generated += delta.content;
    }
    accumulateToolDeltas(toolsAcc, delta);
    if (generationLooped(generated)) looped = true;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      if (mode === "unknown") {
        const start = buf.trimStart();
        if (start.startsWith("data:") || start.startsWith(":")) mode = "sse";
        else if (start.startsWith("{")) mode = "json";
      }
      if (mode !== "sse") continue;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const data = sseData(line);
        if (data === undefined) continue;
        const json = parseCompletionChunk(data);
        if (!json) continue;
        sawEvent = true;
        applyDelta(json.choices?.[0]?.delta);
        const used = usageTokens(json.usage);
        if (used) tokens = used;
      }
      if (looped) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (!sawEvent) return { ok: false, error: String(err), canFallback: true };
    throw err;
  }

  if (mode === "json" || (mode === "unknown" && buf.trim().startsWith("{"))) {
    try {
      return { ok: true, result: resultFromCompletion(JSON.parse(buf) as OpenAiCompletion, schema, onThinking) };
    } catch (err) {
      return { ok: false, error: String(err), canFallback: true };
    }
  }

  if (mode === "sse") {
    const tail = sseData(buf);
    if (tail) {
      const json = parseCompletionChunk(tail);
      if (json) {
        sawEvent = true;
        applyDelta(json.choices?.[0]?.delta);
        const used = usageTokens(json.usage);
        if (used) tokens = used;
      }
    }
  }

  if (!sawEvent) return { ok: false, error: "llm stream: no events", canFallback: true };

  const split = think.finish();
  return {
    ok: true,
    result: finalizeResult({
      text: split.text,
      thinking: [reasoning, split.thinking].filter((value) => value.trim()).join("\n\n"),
      tokens,
      usd: tokens * 0.000002,
      toolCalls: finishToolDeltas(toolsAcc),
    }, schema, looped),
  };
}

function parseCompletionChunk(data: string): OpenAiCompletion | null {
  try {
    return JSON.parse(data) as OpenAiCompletion;
  } catch {
    return null;
  }
}

function sseData(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return undefined;
  return data;
}

function resultFromCompletion(json: OpenAiCompletion, schema: DialectSchema, onThinking?: (delta: string) => void): ChatResult {
  const message = json.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: parseArgs(call.function.arguments),
  }));
  if (!toolCalls.length && message.function_call) {
    toolCalls.push({
      id: "call_0",
      name: message.function_call.name,
      arguments: parseArgs(message.function_call.arguments),
    });
  }
  const split = extractReasoning(message, {
    peelUntagged: schema.think.peelUntagged,
    tagsInContent: schema.think.tagsInContent,
  });
  if (split.thinking) onThinking?.(split.thinking);
  const tokens = usageTokens(json.usage);
  return finalizeResult({
    text: split.text,
    thinking: split.thinking,
    tokens,
    usd: tokens * 0.000002,
    toolCalls,
  }, schema, generationLooped(`${split.thinking}\n${split.text}`));
}

function finalizeResult(result: ChatResult, schema: DialectSchema, looped: boolean): ChatResult {
  const parsed = extractReasoning(
    { content: trimLooped(result.text), thinking: result.thinking },
    { peelUntagged: schema.think.peelUntagged, tagsInContent: schema.think.tagsInContent },
  );
  let thinking = trimLooped(parsed.thinking);
  if (looped) {
    thinking = [thinking, "[stopped: model repeated itself]"].filter(Boolean).join("\n\n");
  }
  return {
    ...result,
    text: parsed.text,
    thinking: thinking || undefined,
  };
}

function withTextTools(result: ChatResult, tools?: ToolSpec[], messages?: ChatMessage[]): ChatResult {
  if (result.toolCalls?.length) {
    return { ...result, text: stripToolMarkup(result.text) || result.text };
  }
  if (!tools?.length) return result;
  const task = [...(messages ?? [])].reverse().find((message) => message.role === "user")?.content;
  const { calls, visible } = hydrateTextTools(`${result.thinking ?? ""}\n${result.text}`, new Set(tools.map((tool) => tool.name)), { task });
  if (!calls.length) return { ...result, text: visible || result.text };
  return { ...result, text: visible, toolCalls: calls };
}

function accumulateToolDeltas(
  acc: Array<{ id: string; name: string; arguments: string }>,
  delta: OpenAiDelta,
): void {
  for (const call of delta.tool_calls ?? []) {
    const index = call.index ?? acc.length;
    acc[index] ??= { id: "", name: "", arguments: "" };
    if (call.id) acc[index].id = call.id;
    if (call.function?.name) acc[index].name += call.function.name;
    if (call.function?.arguments) acc[index].arguments += call.function.arguments;
  }
  if (delta.function_call) {
    acc[0] ??= { id: "call_0", name: "", arguments: "" };
    if (delta.function_call.name) acc[0].name += delta.function_call.name;
    if (delta.function_call.arguments) acc[0].arguments += delta.function_call.arguments;
  }
}

function finishToolDeltas(acc: Array<{ id: string; name: string; arguments: string }>): ToolCall[] {
  return acc
    .filter((call) => call.name)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: parseArgs(call.arguments),
    }));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message === "step interrupted");
}
