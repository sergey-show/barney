import { expect, test } from "bun:test";
import {
  armCount,
  cancelWakesForProcess,
  dueWakes,
  formatWakes,
  markWakeFired,
  parseWakes,
  validateAfterMs,
  validateEveryMs,
  wakePrompt,
  type WakeItem,
  WAKE_MIN_AFTER_MS,
  WAKE_MIN_EVERY_MS,
} from "./wake.ts";

const base: WakeItem = {
  id: "wake_1",
  runId: "run_a",
  agentId: "agent_a",
  kind: "defer",
  status: "armed",
  reason: "check build",
  createdAt: "2026-01-01T00:00:00.000Z",
  fireAt: "2026-01-01T00:01:00.000Z",
};

test("parse/format round-trip", () => {
  const body = formatWakes([base]);
  expect(parseWakes(body)).toEqual([base]);
});

test("due wakes respect fireAt and process exit", () => {
  const now = Date.parse("2026-01-01T00:02:00.000Z");
  const proc: WakeItem = {
    ...base,
    id: "wake_2",
    kind: "process_exit",
    processId: "proc_1",
    fireAt: undefined,
  };
  const due = dueWakes(
    [base, proc, { ...base, id: "wake_3", fireAt: "2026-01-01T00:05:00.000Z" }],
    now,
    new Map([["proc_1", "exited"]]),
    new Map(),
  );
  expect(due.map((item) => item.id).sort()).toEqual(["wake_1", "wake_2"]);
});

test("process_log match arms on substring", () => {
  const item: WakeItem = {
    ...base,
    id: "wake_log",
    kind: "process_log",
    processId: "proc_1",
    logMatch: "listening on",
    fireAt: undefined,
  };
  const due = dueWakes([item], Date.now(), new Map([["proc_1", "running"]]), new Map([["proc_1", "server listening on :8080"]]));
  expect(due).toHaveLength(1);
});

test("interval re-arms after fire", () => {
  const item: WakeItem = {
    ...base,
    kind: "interval",
    everyMs: WAKE_MIN_EVERY_MS,
    fireAt: "2026-01-01T00:00:00.000Z",
  };
  const next = markWakeFired([item], item.id, "2026-01-01T00:00:00.000Z");
  expect(next[0]?.status).toBe("armed");
  expect(Date.parse(next[0]!.fireAt!)).toBe(Date.parse("2026-01-01T00:00:00.000Z") + WAKE_MIN_EVERY_MS);
});

test("guards reject too-soon schedules", () => {
  expect(validateAfterMs(1000)).toContain(String(WAKE_MIN_AFTER_MS));
  expect(validateEveryMs(1000)).toContain(String(WAKE_MIN_EVERY_MS));
  expect(validateAfterMs(WAKE_MIN_AFTER_MS)).toBeNull();
});

test("cancel by process and arm count", () => {
  const items = [
    base,
    { ...base, id: "wake_p", kind: "process_exit" as const, processId: "proc_x", fireAt: undefined },
  ];
  expect(armCount(items)).toBe(2);
  expect(cancelWakesForProcess(items, "proc_x").find((item) => item.id === "wake_p")?.status).toBe("cancelled");
});

test("wake prompt names the reason", () => {
  expect(wakePrompt(base)).toContain("check build");
});
