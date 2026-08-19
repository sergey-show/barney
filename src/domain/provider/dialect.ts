export const DIALECTS = [
  "stub",
  "anthropic",
  "openai",
  "openai-custom",
  "llamacpp",
  "ollama",
  "vllm",
  "groq",
  "openrouter",
] as const;

export type DialectId = (typeof DIALECTS)[number];

export function parseDialect(value?: string | null): DialectId | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "llama.cpp" || trimmed === "llama-cpp") return "llamacpp";
  return (DIALECTS as readonly string[]).includes(trimmed) ? trimmed as DialectId : null;
}

export function detectDialect(input: {
  name?: string;
  host?: string;
  kind?: string;
  dialect?: string | null;
}): DialectId {
  const explicit = parseDialect(input.dialect);
  if (explicit) return explicit;
  if (input.kind === "stub") return "stub";
  if (input.kind === "anthropic") return "anthropic";

  const blob = `${input.name ?? ""} ${input.host ?? ""}`.toLowerCase();
  if (/\banthropic\b/.test(blob)) return "anthropic";
  if (/openrouter/.test(blob)) return "openrouter";
  if (/\bgroq\b/.test(blob)) return "groq";
  if (/\bollama\b/.test(blob)) return "ollama";
  if (/\bvllm\b/.test(blob)) return "vllm";
  if (/llama\.cpp|llamacpp|llama-cpp/.test(blob)) return "llamacpp";
  if (/api\.openai\.com/.test(blob) || input.name?.trim().toLowerCase() === "openai") return "openai";
  if (/:11434\b/.test(blob)) return "llamacpp";
  return "openai-custom";
}
