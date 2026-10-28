import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFileListsFromTranscript } from "./compactStructured.ts";
import { isContextOverflowError, isOutputLengthFinish } from "./overflowRecovery.ts";
import { loadProjectContextFiles } from "./projectContext.ts";
import { offloadToolOutput } from "./toolOutputOffload.ts";
import { MessageQueue } from "../services/MessageQueue.ts";
import { emptyTree, forkBranch, switchBranch } from "../session/SessionTree.ts";
import { runCodemodeScript } from "../tools/codemode.ts";
import { createDefaultToolRegistry } from "../tools/ToolRegistry.ts";

test("offload writes full_output_path when over limit", () => {
  const session = mkdtempSync(join(tmpdir(), "barney-off-"));
  const big = "x".repeat(5_000);
  const off = offloadToolOutput({
    text: big,
    sessionPath: session,
    callId: "c1",
    tool: "shell",
    maxChars: 100,
  });
  expect(off.truncated).toBe(true);
  expect(off.fullPath).toBeTruthy();
  expect(off.forModel).toContain("full_output_path");
  expect(readFileSync(off.fullPath!, "utf8")).toBe(big);
});

test("overflow detectors", () => {
  expect(isContextOverflowError(new Error("context_length_exceeded"))).toBe(true);
  expect(isOutputLengthFinish("length")).toBe(true);
  expect(isOutputLengthFinish("stop")).toBe(false);
});

test("project context loads AGENTS.md", () => {
  const root = mkdtempSync(join(tmpdir(), "barney-proj-"));
  writeFileSync(join(root, "AGENTS.md"), "Always use bun.");
  const ctx = loadProjectContextFiles(root);
  expect(ctx).toContain("AGENTS.md");
  expect(ctx).toContain("Always use bun");
});

test("structured file lists from console", () => {
  const lists = extractFileListsFromTranscript([
    { kind: "console", text: `fs_read ${JSON.stringify({ path: "a.ts" })}\nok` },
    { kind: "console", text: `fs_write ${JSON.stringify({ path: "b.ts", content: "x" })}\nok` },
  ]);
  expect(lists.readFiles).toContain("a.ts");
  expect(lists.modifiedFiles).toContain("b.ts");
});

test("MessageQueue steer one-at-a-time", () => {
  const q = new MessageQueue();
  q.enqueueSteer("r1", "a");
  q.enqueueSteer("r1", "b");
  expect(q.drainSteer("r1")).toEqual(["a"]);
  expect(q.drainSteer("r1")).toEqual(["b"]);
  expect(q.drainSteer("r1")).toEqual([]);
});

test("session tree fork and switch", () => {
  const tree = emptyTree([{ id: "1", kind: "user", text: "hi", at: "t" }]);
  const forked = forkBranch(tree, [{ id: "1", kind: "user", text: "hi", at: "t" }, { id: "2", kind: "assistant", text: "yo", at: "t" }], "alt");
  expect(forked.tree.branches).toHaveLength(2);
  const switched = switchBranch(forked.tree, tree.activeId, forked.tree.branches[1]!.transcript);
  expect(switched.tree.activeId).toBe(tree.activeId);
});

test("codemode call allowlist", async () => {
  const result = await runCodemodeScript({
    script: `const a = await call("grep", { pattern: "x" }); return a;`,
    allowed: new Set(["grep"]),
    call: async (name) => `ok:${name}`,
  });
  expect(result.ok).toBe(true);
  expect(result.output).toContain("ok:grep");
});

test("deferred MCP stays hidden until tool_search", () => {
  const reg = createDefaultToolRegistry();
  reg.setMcpTools([
    { server: "git", name: "status", description: "st", exposure: "deferred" },
    { server: "git", name: "diff", description: "df", exposure: "direct" },
  ]);
  const deferred = "mcp__git__status";
  const direct = "mcp__git__diff";
  const before = new Set(reg.specsFor(0).map((t) => t.name));
  expect(before.has(deferred)).toBe(false);
  expect(before.has(direct)).toBe(true);
  const listed = reg.searchMcp("status");
  expect(listed).toContain(deferred);
  const after = new Set(reg.specsFor(0).map((t) => t.name));
  expect(after.has(deferred)).toBe(true);
});
