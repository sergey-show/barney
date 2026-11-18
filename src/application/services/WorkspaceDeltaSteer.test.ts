import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceDeltaSteer } from "./WorkspaceDeltaSteer.ts";

test("baseline then change emits steer text", () => {
  const root = join(tmpdir(), `barney-delta-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const file = join(root, "a.txt");
  writeFileSync(file, "one");
  const watcher = new WorkspaceDeltaSteer({ root, debounceMs: 0 });
  expect(watcher.baseline()).toBeGreaterThan(0);
  expect(watcher.poll().steerText).toBeNull();
  writeFileSync(file, "two");
  const second = watcher.poll();
  expect(second.deltas.length).toBeGreaterThan(0);
  expect(second.steerText).toContain("workspace_delta");
});
