import { detectDialect, type DialectId } from "../../../domain/provider/dialect.ts";
import type { LlmProvider } from "../../../domain/provider/LlmProvider.ts";

export type ThinkField = "reasoning_content" | "reasoning" | "thinking";

export type DialectSchema = {
  id: DialectId;
  transport: "openai-chat" | "anthropic-messages" | "stub";
  think: {
    fields: ThinkField[];
    tagsInContent: boolean;
    peelUntagged: boolean;
  };
  request: {
    maxTokens: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    repeatPenalty?: number;
    dryMultiplier?: number;
    enableThinkingKwargs: boolean;
    thinkFlag: boolean;
  };
};

const OPENAI_THINK: DialectSchema["think"] = {
  fields: ["reasoning_content", "reasoning", "thinking"],
  tagsInContent: true,
  peelUntagged: true,
};

const CHANNEL_THINK: DialectSchema["think"] = {
  fields: ["reasoning_content", "reasoning", "thinking"],
  tagsInContent: true,
  peelUntagged: false,
};

const SCHEMAS: Record<DialectId, DialectSchema> = {
  stub: {
    id: "stub",
    transport: "stub",
    think: { fields: [], tagsInContent: false, peelUntagged: false },
    request: { maxTokens: 256, enableThinkingKwargs: false, thinkFlag: false },
  },
  anthropic: {
    id: "anthropic",
    transport: "anthropic-messages",
    think: { fields: ["thinking"], tagsInContent: true, peelUntagged: false },
    request: { maxTokens: 2048, enableThinkingKwargs: false, thinkFlag: false },
  },
  openai: {
    id: "openai",
    transport: "openai-chat",
    think: OPENAI_THINK,
    request: {
      maxTokens: 4096,
      presencePenalty: 0.2,
      frequencyPenalty: 0.2,
      enableThinkingKwargs: false,
      thinkFlag: false,
    },
  },
  groq: {
    id: "groq",
    transport: "openai-chat",
    think: OPENAI_THINK,
    request: {
      maxTokens: 4096,
      presencePenalty: 0.2,
      frequencyPenalty: 0.2,
      enableThinkingKwargs: false,
      thinkFlag: false,
    },
  },
  openrouter: {
    id: "openrouter",
    transport: "openai-chat",
    think: OPENAI_THINK,
    request: {
      maxTokens: 4096,
      presencePenalty: 0.2,
      frequencyPenalty: 0.2,
      enableThinkingKwargs: false,
      thinkFlag: false,
    },
  },
  "openai-custom": {
    id: "openai-custom",
    transport: "openai-chat",
    think: OPENAI_THINK,
    request: {
      maxTokens: 4096,
      presencePenalty: 0.2,
      frequencyPenalty: 0.2,
      enableThinkingKwargs: false,
      thinkFlag: false,
    },
  },
  llamacpp: {
    id: "llamacpp",
    transport: "openai-chat",
    think: CHANNEL_THINK,
    request: {
      maxTokens: 4096,
      enableThinkingKwargs: true,
      thinkFlag: false,
    },
  },
  ollama: {
    id: "ollama",
    transport: "openai-chat",
    think: CHANNEL_THINK,
    request: {
      maxTokens: 4096,
      enableThinkingKwargs: false,
      thinkFlag: true,
    },
  },
  vllm: {
    id: "vllm",
    transport: "openai-chat",
    think: CHANNEL_THINK,
    request: {
      maxTokens: 4096,
      enableThinkingKwargs: false,
      thinkFlag: false,
    },
  },
};

export function schemaFor(provider: Pick<LlmProvider, "name" | "baseUrl" | "kind" | "dialect">): DialectSchema {
  const id = provider.dialect || detectDialect({
    name: provider.name,
    host: provider.baseUrl,
    kind: provider.kind,
  });
  const schema = SCHEMAS[id];
  if (id === "openai-custom" && isLocalHost(provider.baseUrl)) {
    return {
      ...schema,
      request: {
        ...schema.request,
        repeatPenalty: 1.12,
        dryMultiplier: 0.8,
      },
    };
  }
  return schema;
}

export function requestBodyExtras(schema: DialectSchema): Record<string, unknown> {
  const body: Record<string, unknown> = { max_tokens: schema.request.maxTokens };
  if (schema.request.presencePenalty != null) body.presence_penalty = schema.request.presencePenalty;
  if (schema.request.frequencyPenalty != null) body.frequency_penalty = schema.request.frequencyPenalty;
  if (schema.request.repeatPenalty != null) body.repeat_penalty = schema.request.repeatPenalty;
  if (schema.request.dryMultiplier != null) body.dry_multiplier = schema.request.dryMultiplier;
  if (schema.request.enableThinkingKwargs) {
    body.chat_template_kwargs = { enable_thinking: true };
  }
  if (schema.request.thinkFlag) body.think = true;
  return body;
}

function isLocalHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}
