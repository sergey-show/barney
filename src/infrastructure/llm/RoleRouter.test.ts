import { expect, test } from "bun:test";
import { LlmProvider } from "../../domain/provider/LlmProvider.ts";
import { isFastRole, preferFastModel } from "./RoleRouter.ts";

test("ego roles prefer a lighter model on the same provider", () => {
  const anthropic = LlmProvider.create({ name: "anthropic", kind: "anthropic", host: "https://api.anthropic.com/v1/messages", defaultModel: "claude-sonnet-4-5" });
  expect(preferFastModel(anthropic, "claude-sonnet-4-5")).toBe("claude-haiku-4-5");
  const openai = LlmProvider.create({ name: "openai", kind: "openai-compat", host: "https://api.openai.com/v1", defaultModel: "gpt-4.1" });
  expect(preferFastModel(openai, "gpt-4.1")).toBe("gpt-4.1-mini");
  expect(preferFastModel(openai, "gpt-4.1-mini")).toBe("gpt-4.1-mini");
  expect(isFastRole("reviewer")).toBe(true);
  expect(isFastRole("coder")).toBe(false);
});
