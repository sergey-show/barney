import { expect, test } from "bun:test";
import { groupTranscript, isOpenWork } from "./transcript.ts";

const item = (id: string, kind: string, text = kind) => ({ id, kind, text, at: "" });

test("only the last work fold after the user is live while waiting for an assistant", () => {
  const entries = groupTranscript([
    item("t0", "thinking", "old reviewer json"),
    item("u1", "user", "а если jira DC"),
    item("t1", "thinking", "new thought"),
  ]);
  expect(entries).toHaveLength(3);
  expect(isOpenWork(0, entries)).toBe(false);
  expect(isOpenWork(2, entries)).toBe(true);
});

test("work before an assistant reply is not live", () => {
  const entries = groupTranscript([
    item("u1", "user", "hi"),
    item("t1", "thinking", "plan"),
    item("a1", "assistant", "done"),
    item("t2", "thinking", "review"),
  ]);
  expect(isOpenWork(1, entries)).toBe(false);
  expect(isOpenWork(3, entries)).toBe(true);
});
