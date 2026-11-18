import { expect, test } from "bun:test";
import { ElicitationGate } from "./ElicitationGate.ts";

test("register pauses until answer", async () => {
  const gate = new ElicitationGate();
  const elic = gate.register({ sessionId: "r1", prompt: "allow shell:rm?", kind: "approval" });
  expect(gate.isPaused("r1")).toBe(true);
  const pending = gate.wait(elic.id, 2_000);
  expect(gate.answerSession("r1", "allow")).toBeTruthy();
  const result = await pending;
  expect(result.status).toBe("answered");
  expect(gate.isPaused("r1")).toBe(false);
});

test("timeout marks timed_out", async () => {
  const gate = new ElicitationGate();
  const elic = gate.register({ sessionId: "r2", prompt: "clarify?" });
  const result = await gate.wait(elic.id, 20);
  expect(result.status).toBe("timed_out");
});
