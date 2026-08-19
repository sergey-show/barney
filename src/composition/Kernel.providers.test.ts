import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "./Kernel.ts";

test("saving a provider with an existing name updates host instead of failing", async () => {
  const kernel = new Kernel(mkdtempSync(join(tmpdir(), "barney-prov-")));
  const first = await kernel.addOpenAiProvider({ name: "local-dev", host: "http://127.0.0.1:11434/v1" });
  const second = await kernel.addOpenAiProvider({ name: "local-dev", host: "http://192.168.68.122:11434/v1" });
  expect(second.id).toBe(first.id);
  expect(second.baseUrl).toBe("http://192.168.68.122:11434/v1");
  const listed = await kernel.providerState();
  expect(listed.providers.filter((item) => item.name === "local-dev")).toHaveLength(1);
  expect(second.dialect).toBe("llamacpp");
});

test("useLanes binds large to coder and small to reviewer", async () => {
  const kernel = new Kernel(mkdtempSync(join(tmpdir(), "barney-lanes-")));
  const large = await kernel.addOpenAiProvider({ name: "big", host: "http://192.168.68.122:11434/v1" });
  const small = await kernel.addOpenAiProvider({ name: "fast", host: "http://127.0.0.1:11434/v1" });
  const state = await kernel.useLanes({
    large: { providerId: large.id, model: "Qwen3.6-35B-A3B-Hermes-V6" },
    small: { providerId: small.id, model: "qwen2.5-7b" },
  });
  expect(state.lanes.large).toEqual({ providerId: large.id, model: "Qwen3.6-35B-A3B-Hermes-V6" });
  expect(state.lanes.small).toEqual({ providerId: small.id, model: "qwen2.5-7b" });
  expect(state.bindings.find((item) => item.role === "coder")?.model).toBe("Qwen3.6-35B-A3B-Hermes-V6");
  expect(state.bindings.find((item) => item.role === "reviewer")?.model).toBe("qwen2.5-7b");
  expect(state.bindings.find((item) => item.role === "planner")?.providerId).toBe(small.id);
});
