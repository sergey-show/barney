import type { LlmPort, ProviderCatalog } from "../../application/ports.ts";
import { LlmProvider } from "../../domain/provider/LlmProvider.ts";
import { ROLES, type ChatMessage, type ChatResult, type CompleteOptions, type Role } from "../../domain/provider/Role.ts";
import { clientFor } from "./clients/clientFor.ts";
import { requestBodyExtras, schemaFor } from "./clients/schema.ts";
import { fetchEmbeddings } from "./embed.ts";

export { parseModelIds } from "./clients/openaiChat.ts";
export { extractReasoning, ThinkStreamFilter } from "./thinkParse.ts";

export function compatSampling(provider: LlmProvider): Record<string, unknown> {
  return requestBodyExtras(schemaFor(provider));
}

export class RoleRouter implements LlmPort {
  constructor(private readonly catalog: ProviderCatalog) {}

  async complete(role: Role, messages: ChatMessage[], options?: CompleteOptions): Promise<ChatResult> {
    const started = Date.now();
    const { provider, model } = await resolveBinding(this.catalog, role);
    const normalized = collapseSystemMessages(messages);
    const result = await clientFor(provider).complete({
      role,
      model,
      messages: normalized,
      tools: options?.tools,
      toolChoice: options?.toolChoice,
      signal: options?.signal,
      onThinking: options?.onThinking,
    });
    return { ...result, model: result.model || model, ms: result.ms ?? Date.now() - started };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
    const { provider, model } = await resolveBinding(this.catalog, "embedder");
    return fetchEmbeddings(provider, model, texts, signal);
  }
}

export async function listRemoteModels(provider: LlmProvider): Promise<string[]> {
  return clientFor(provider).listModels();
}

async function resolveBinding(catalog: ProviderCatalog, role: Role): Promise<{ provider: LlmProvider; model: string }> {
  const bindings = await catalog.bindings();
  const binding = bindings.find((b) => b.role === role) ?? bindings[0];
  if (binding) {
    const provider = await catalog.get(binding.providerId);
    if (provider) {
      const bound = binding.model || provider.defaultModel || "default";
      return { provider, model: bound };
    }
  }
  const listed = await catalog.list();
  const fallback = listed.find((p) => p.kind !== "stub") ?? listed[0];
  if (!fallback) throw new Error("no providers configured");
  return { provider: fallback, model: fallback.defaultModel || "default" };
}

export function collapseSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean);
  const rest = messages.filter((m) => m.role !== "system");
  return systems.length ? [{ role: "system", content: systems.join("\n\n") }, ...rest] : rest;
}

export async function seedBuiltinProviders(catalog: ProviderCatalog): Promise<void> {
  if (!(await catalog.findByName("stub"))) {
    await catalog.save(LlmProvider.create({ name: "stub", kind: "stub", host: "", defaultModel: "stub" }));
  }
  if (process.env.ANTHROPIC_API_KEY && !(await catalog.findByName("anthropic"))) {
    await catalog.save(LlmProvider.create({
      name: "anthropic",
      kind: "anthropic",
      host: "https://api.anthropic.com/v1/messages",
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel: "claude-sonnet-4-5",
    }));
  }
  if (process.env.OPENAI_API_KEY && !(await catalog.findByName("openai"))) {
    await catalog.save(LlmProvider.create({
      name: "openai",
      kind: "openai-compat",
      host: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: "gpt-4.1-mini",
    }));
  }
  if (process.env.GROQ_API_KEY && !(await catalog.findByName("groq"))) {
    await catalog.save(LlmProvider.create({
      name: "groq",
      kind: "openai-compat",
      host: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      defaultModel: "llama-3.3-70b-versatile",
    }));
  }
  const bindings = await catalog.bindings();
  if (bindings.length === 0) {
    const preferred =
      (await catalog.findByName("anthropic")) ??
      (await catalog.findByName("groq")) ??
      (await catalog.findByName("openai")) ??
      (await catalog.findByName("stub"));
    if (preferred) await catalog.setDefault(preferred.id, preferred.defaultModel ?? "default");
  }
  await seedUnifiedRoleBindings(catalog);
}

/** Planner, reviewer, and coder share the bound model. A lighter second model degrades review. */
export async function seedUnifiedRoleBindings(catalog: ProviderCatalog): Promise<void> {
  const bindings = await catalog.bindings();
  const coder = bindings.find((item) => item.role === "coder") ?? bindings[0];
  if (!coder) return;
  const provider = await catalog.get(coder.providerId);
  if (!provider) return;
  const model = coder.model || provider.defaultModel || "default";
  for (const role of ROLES) {
    const current = bindings.find((item) => item.role === role);
    if (current?.providerId === coder.providerId && current.model === model) continue;
    await catalog.setBinding(role, coder.providerId, model);
  }
}
