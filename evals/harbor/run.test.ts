import { expect, test } from "bun:test";
import { parseArgs, parseHarborModel, transcriptEvents } from "./run.ts";
import type { Run } from "../../src/domain/run/Run.ts";

test("parses Harbor provider/model the same way OpenCode does", () => {
  const openai = parseHarborModel("openai/gpt-4.1", { OPENAI_API_KEY: "sk-test" });
  expect(openai.kind).toBe("openai-compat");
  expect(openai.model).toBe("gpt-4.1");
  expect(openai.apiKey).toBe("sk-test");

  const anthropic = parseHarborModel("anthropic/claude-sonnet-4-5", { ANTHROPIC_API_KEY: "sk-ant" });
  expect(anthropic.kind).toBe("anthropic");
  expect(anthropic.host).toContain("/v1/messages");

  const router = parseHarborModel("openrouter/qwen/qwen3-coder", { OPENROUTER_API_KEY: "or" });
  expect(router.kind).toBe("openai-compat");
  expect(router.model).toBe("qwen/qwen3-coder");
  expect(router.host).toContain("openrouter.ai");

  const ollama = parseHarborModel("ollama/Qwen3.6-35B-A3B-Hermes-V6", {});
  expect(ollama.kind).toBe("openai-compat");
  expect(ollama.model).toBe("Qwen3.6-35B-A3B-Hermes-V6");
  expect(ollama.host).toBe("http://127.0.0.1:11434/v1");
});

test("parseArgs takes instruction after -- like OpenCode run", () => {
  const parsed = parseArgs(["--model", "openai/gpt-4.1", "--", "fix the tests"]);
  expect(parsed.modelSpec).toBe("openai/gpt-4.1");
  expect(parsed.instruction).toBe("fix the tests");
});

test("transcriptEvents keeps tool console for ATIF", () => {
  const run = {
    transcript: [
      { kind: "user", text: "write hello", at: "t0" },
      { kind: "console", text: "fs_write {\"path\":\"hello.txt\"}\nwrote", at: "t1" },
      { kind: "assistant", text: "done", at: "t2", meta: { tokens: 9 } },
    ],
  } as unknown as Run;
  const events = transcriptEvents(run);
  expect(events).toHaveLength(3);
  expect(events[1]).toMatchObject({ type: "event", kind: "console" });
});
