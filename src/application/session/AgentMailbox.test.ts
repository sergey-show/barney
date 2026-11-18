import { expect, test } from "bun:test";
import { AgentMailboxBus, drainMail, enqueueMail, formatMailForPrompt } from "./AgentMailbox.ts";

test("enqueue and drain unread mail", () => {
  let box = enqueueMail([], { from: "parent", to: "child", kind: "task", body: "explore auth" });
  box = enqueueMail(box, { from: "child", to: "parent", kind: "result", body: "found gap" });
  const { drained, remaining } = drainMail(box, { limit: 1 });
  expect(drained).toHaveLength(1);
  expect(remaining).toHaveLength(1);
  expect(formatMailForPrompt(drained)).toContain("agent_mail");
});

test("bus fan-out", () => {
  const bus = new AgentMailboxBus();
  bus.send({ from: "a", to: "b", kind: "notice", body: "hi" });
  expect(bus.drain("b")[0]?.body).toBe("hi");
  expect(bus.drain("b")).toHaveLength(0);
});
