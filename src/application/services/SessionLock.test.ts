import { expect, test } from "bun:test";
import { BusyError, SessionLock } from "./SessionLock.ts";

test("SessionLock replace aborts previous", () => {
  const lock = new SessionLock();
  const a = lock.begin("r1", "replace");
  const b = lock.begin("r1", "replace");
  expect(a.signal.aborted).toBe(true);
  expect(b.signal.aborted).toBe(false);
  lock.end("r1", b);
  expect(lock.isRunning("r1")).toBe(false);
});

test("SessionLock reject throws BusyError", () => {
  const lock = new SessionLock();
  lock.begin("r1", "reject");
  expect(() => lock.begin("r1", "reject")).toThrow(BusyError);
});
