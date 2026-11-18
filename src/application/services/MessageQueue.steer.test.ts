import { expect, test } from "bun:test";
import { MessageQueue } from "./MessageQueue.ts";

test("rejects empty steer and tags non-operator sources", () => {
  const q = new MessageQueue();
  expect(q.enqueueSteer("r1", "   ").ok).toBe(false);
  expect(q.enqueueSteer("r1", "delta", "workspace_delta").ok).toBe(true);
  expect(q.drainSteer("r1")[0]).toContain("[steer:workspace_delta]");
});

test("respects cap", () => {
  const q = new MessageQueue();
  q.setCap("r1", 1);
  expect(q.enqueueSteer("r1", "a").ok).toBe(true);
  expect(q.enqueueSteer("r1", "b").reason).toBe("cap");
});
