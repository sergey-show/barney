import { expect, test } from "bun:test";
import {
  decideAfterRound,
  DEFAULT_AGENT_LOOP,
  DoomTracker,
  isFinalToolStep,
  runAgentToolLoop,
  type ActRound,
} from "./AgentLoop.ts";

test("decideAfterRound stops on doom and abort", () => {
  expect(decideAfterRound({
    step: 0,
    config: DEFAULT_AGENT_LOOP,
    hasToolCalls: true,
    keepWriting: 0,
    hasLeftover: false,
    doom: true,
    aborted: false,
  }).halt).toBe("doom_loop");
  expect(decideAfterRound({
    step: 0,
    config: DEFAULT_AGENT_LOOP,
    hasToolCalls: false,
    keepWriting: 0,
    hasLeftover: false,
    doom: false,
    aborted: true,
  }).halt).toBe("aborted");
});

test("decideAfterRound keep_writing when leftover and under budget", () => {
  const d = decideAfterRound({
    step: 1,
    config: DEFAULT_AGENT_LOOP,
    hasToolCalls: false,
    keepWriting: 0,
    hasLeftover: true,
    doom: false,
    aborted: false,
  });
  expect(d.action).toBe("keep_writing");
});

test("decideAfterRound max_steps when last tool round", () => {
  const d = decideAfterRound({
    step: 11,
    config: { ...DEFAULT_AGENT_LOOP, maxSteps: 12 },
    hasToolCalls: true,
    keepWriting: 0,
    hasLeftover: false,
    doom: false,
    aborted: false,
  });
  expect(d.halt).toBe("max_steps");
});

test("DoomTracker trips after threshold identical fails", () => {
  const doom = new DoomTracker(3);
  const call = { name: "shell", arguments: { command: "false" } };
  expect(doom.noteFailure(call)).toBe(false);
  expect(doom.noteFailure(call)).toBe(false);
  expect(doom.noteFailure(call)).toBe(true);
});

test("runAgentToolLoop completes when model stops calling tools", async () => {
  const parts: string[] = [];
  const result = await runAgentToolLoop<ActRound>({
    config: { maxSteps: 4 },
    hooks: { onPart: (p) => parts.push(p.kind) },
    seed: { text: "", tokens: 0, usd: 0 },
    complete: async () => ({ text: "done", tokens: 1, usd: 0 }),
    hasLeftover: () => false,
    executeTools: async () => ({ doom: false }),
  });
  expect(result.halt).toBe("done");
  expect(result.act.text).toBe("done");
  expect(parts).toContain("step_start");
  expect(parts).toContain("step_end");
});

test("runAgentToolLoop runs tools then stops", async () => {
  let round = 0;
  const result = await runAgentToolLoop<ActRound>({
    config: { maxSteps: 5, stripToolsOnLastStep: false },
    seed: { text: "", tokens: 0, usd: 0 },
    complete: async () => {
      round += 1;
      if (round === 1) {
        return {
          text: "working",
          tokens: 1,
          usd: 0,
          toolCalls: [{ id: "1", name: "fs_list", arguments: { path: "." } }],
        };
      }
      return { text: "finished", tokens: 1, usd: 0 };
    },
    hasLeftover: () => false,
    executeTools: async () => ({ doom: false }),
  });
  expect(result.halt).toBe("done");
  expect(result.steps).toBe(2);
  expect(result.act.text).toBe("finished");
});

test("isFinalToolStep and strip tools on last step", async () => {
  expect(isFinalToolStep(11, DEFAULT_AGENT_LOOP)).toBe(true);
  const modes: string[] = [];
  const result = await runAgentToolLoop<ActRound>({
    config: { maxSteps: 2, stripToolsOnLastStep: true },
    seed: { text: "", tokens: 0, usd: 0 },
    complete: async (_step, mode) => {
      modes.push(mode);
      if (mode === "final") return { text: "answer", tokens: 1, usd: 0, toolCalls: [{ id: "x", name: "shell", arguments: {} }] };
      return {
        text: "work",
        tokens: 1,
        usd: 0,
        toolCalls: [{ id: "1", name: "fs_list", arguments: { path: "." } }],
      };
    },
    hasLeftover: () => false,
    executeTools: async () => ({ doom: false }),
  });
  expect(modes).toContain("final");
  expect(result.act.toolCalls).toBeUndefined();
  expect(result.reason).toMatch(/tools stripped/);
});
