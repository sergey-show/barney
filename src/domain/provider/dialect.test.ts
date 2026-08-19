import { expect, test } from "bun:test";
import { detectDialect, parseDialect } from "./dialect.ts";
import { LlmProvider } from "./LlmProvider.ts";
import { extractReasoning } from "../../infrastructure/llm/thinkParse.ts";
import { requestBodyExtras, schemaFor } from "../../infrastructure/llm/clients/schema.ts";

test("detects llama.cpp on 11434 and by name", () => {
  expect(detectDialect({ name: "local-dev", host: "http://127.0.0.1:11434/v1" })).toBe("llamacpp");
  expect(detectDialect({ name: "llama.cpp", host: "http://10.0.0.2:8080/v1" })).toBe("llamacpp");
  expect(parseDialect("llama.cpp")).toBe("llamacpp");
});

test("detects named cloud and local dialects", () => {
  expect(detectDialect({ name: "openai", host: "https://api.openai.com/v1" })).toBe("openai");
  expect(detectDialect({ name: "groq", host: "https://api.groq.com/openai/v1" })).toBe("groq");
  expect(detectDialect({ name: "ollama", host: "http://127.0.0.1:11434/v1" })).toBe("ollama");
  expect(detectDialect({ name: "vllm", host: "http://127.0.0.1:8000/v1" })).toBe("vllm");
  expect(detectDialect({ name: "proxy", host: "https://litellm.example/v1" })).toBe("openai-custom");
});

test("explicit dialect wins over host heuristics", () => {
  expect(detectDialect({ name: "local", host: "http://127.0.0.1:11434/v1", dialect: "ollama" })).toBe("ollama");
});

test("llama.cpp schema does not peel English answers and does not send penalties", () => {
  const provider = LlmProvider.create({
    name: "local",
    kind: "openai-compat",
    host: "http://192.168.68.122:11434/v1",
  });
  expect(provider.dialect).toBe("llamacpp");
  const schema = schemaFor(provider);
  expect(schema.think.peelUntagged).toBe(false);
  const extras = requestBodyExtras(schema);
  expect(extras.presence_penalty).toBeUndefined();
  expect(extras.chat_template_kwargs).toEqual({ enable_thinking: true });

  const split = extractReasoning({
    content: "Let me check the logs next.",
    reasoning_content: "The user asked for a status line.",
  }, { peelUntagged: false });
  expect(split.text).toBe("Let me check the logs next.");
  expect(split.thinking).toContain("The user asked");
});
