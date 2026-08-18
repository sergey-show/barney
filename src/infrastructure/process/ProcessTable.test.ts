import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessTable } from "./ProcessTable.ts";
import { runProcessTool } from "../../application/tools/runProcessTool.ts";

test("captures logs while a background process is still running", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "barney-proc-"));
  const table = new ProcessTable();
  const started = await table.spawn({
    runId: "run1",
    cwd,
    command: "/bin/sh",
    args: ["-c", "printf first-line\\n; sleep 2; printf second-line\\n"],
  });
  await Bun.sleep(200);
  const logs = await table.logs(started.id);
  expect(logs).toContain("first-line");
  const listed = await table.list("run1");
  expect(listed[0]?.status).toBe("running");
  await table.kill(started.id);
  expect((await table.list("run1"))[0]?.status).toBe("killed");
});

test("process_spawn blocks privileged commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "barney-proc-"));
  const table = new ProcessTable();
  const out = await runProcessTool(table, {
    id: "1",
    name: "process_spawn",
    arguments: { command: "sudo ls" },
  }, { runId: "run1", cwd });
  expect(out).toContain("blocked");
  expect(await table.list("run1")).toEqual([]);
});

test("process_spawn then logs a short command", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "barney-proc-"));
  const table = new ProcessTable();
  const started = await runProcessTool(table, {
    id: "1",
    name: "process_spawn",
    arguments: { command: "echo harness-bg" },
  }, { runId: "run1", cwd });
  expect(started).toMatch(/started proc_/);
  const id = started.match(/started (proc_\w+)/)?.[1];
  expect(id).toBeTruthy();
  await Bun.sleep(300);
  const logs = await runProcessTool(table, {
    id: "2",
    name: "process_logs",
    arguments: { id },
  }, { runId: "run1", cwd });
  expect(logs).toContain("harness-bg");
  await table.killRun("run1");
});
