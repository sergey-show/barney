import { expect, test } from "bun:test";
import { Agent } from "../agent/Agent.ts";
import { Run } from "./Run.ts";
import { packSession } from "../../application/context/packSession.ts";

test("interrupt keeps partial assistant reply", () => {
  const agent = Agent.create({ name: "t" });
  const run = Run.start(agent, { goal: "x", worktreePath: "/tmp/ws" });
  run.beginAct("retry_with_error", "long");
  const events = run.interrupt("stopped", { partialText: "hello partial" });
  expect(run.status).toBe("ready");
  const partial = run.transcript.find((item) => item.kind === "assistant" && item.meta?.partial);
  expect(partial?.text).toBe("hello partial");
  expect(events.some((e) => e.type === "run.transcript_item")).toBe(true);
  expect(events.some((e) => e.type === "run.interrupted")).toBe(true);
});

test("truncateFrom drops from item onward", () => {
  const agent = Agent.create({ name: "t" });
  const run = Run.start(agent, { goal: "x", worktreePath: "/tmp/ws" });
  const u1 = run.append("user", "first");
  run.append("assistant", "a1");
  run.append("user", "second");
  run.truncateFrom(u1.id);
  expect(run.transcript.some((item) => item.text === "first")).toBe(false);
  expect(run.transcript.some((item) => item.text === "second")).toBe(false);
  expect(run.status).toBe("ready");
});

test("summary cursor gates packSession durable window", () => {
  const transcript = [];
  for (let i = 0; i < 10; i += 1) {
    transcript.push({ kind: "user", text: `old-${i}` });
    transcript.push({ kind: "assistant", text: `old-a-${i}` });
  }
  transcript.push({ kind: "assistant", text: "SUMMARY HERE", meta: { summary: true } });
  transcript.push({ kind: "user", text: "after" });
  transcript.push({ kind: "assistant", text: "reply" });
  const packed = packSession(transcript, "goal");
  expect(packed.digest).toContain("SUMMARY HERE");
  expect(packed.digest).not.toContain("old-0");
  expect(packed.recent.some((m) => m.content.includes("after"))).toBe(true);
});
