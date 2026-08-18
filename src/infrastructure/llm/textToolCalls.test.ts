import { expect, test } from "bun:test";
import { extractToolCallsFromText, hydrateTextTools, stripToolMarkup } from "./textToolCalls.ts";

const allowed = new Set(["agent_spawn", "fs_write", "memory_search"]);

test("parses a bare Hermes action tag", () => {
  const calls = extractToolCallsFromText("<action>agent_spawn</action>", allowed);
  expect(calls[0]?.name).toBe("agent_spawn");
});

test("parses a JSON tool_call block", () => {
  const calls = extractToolCallsFromText(
    `<tool_call>{"name":"fs_write","arguments":{"path":"rtx.md","content":"# GPU"}}</tool_call>`,
    allowed,
  );
  expect(calls[0]?.name).toBe("fs_write");
  expect(calls[0]?.arguments.path).toBe("rtx.md");
});

test("maps legacy skill_* text tools to plugin_*", () => {
  const allowed = new Set(["plugin_write", "plugin_open"]);
  const calls = extractToolCallsFromText(
    `<action>skill_write</action>{"name":"file-viewer","path":"ui.html","content":"<html>"}`,
    allowed,
  );
  expect(calls[0]?.name).toBe("plugin_write");
  expect(calls[0]?.arguments.name).toBe("file-viewer");
});

test("fills spawn args from the user task and strips markup", () => {
  const { calls, visible } = hydrateTextTools("<action>agent_spawn</action>", allowed, {
    task: "write rtx-3090.md with specs",
  });
  expect(calls[0]?.arguments.name).toBe("researcher");
  expect(calls[0]?.arguments.task).toContain("rtx-3090");
  expect(calls[1]?.name).toBe("agent_delegate");
  expect(visible).toBe("");
  expect(stripToolMarkup("done\n<action>agent_spawn</action>")).toBe("done");
});
