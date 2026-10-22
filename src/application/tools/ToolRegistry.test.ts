import { expect, test } from "bun:test";
import { defineTool, toolResult } from "./Tool.ts";
import { createDefaultToolRegistry, mcpToolName, parseMcpToolName } from "./ToolRegistry.ts";

test("defineTool sanitizes id dots", () => {
  const t = defineTool({
    name: "fs_read",
    id: "fs.read",
    description: "x",
    parameters: { type: "object", properties: {} },
  });
  expect(t.id).toBe("fs_read");
});

test("toolResult separates output and metadata", () => {
  const r = toolResult("ok", { title: "grep", matches: 3 });
  expect(r.output).toBe("ok");
  expect(r.metadata?.matches).toBe(3);
});

test("ToolRegistry merges MCP tools with prefix", () => {
  const reg = createDefaultToolRegistry();
  reg.setMcpTools([{ server: "git", name: "status", description: "git status" }]);
  const specs = reg.specsFor(0);
  expect(specs.some((t) => t.name === mcpToolName("git", "status"))).toBe(true);
  expect(parseMcpToolName(mcpToolName("git", "status"))).toEqual({
    server: "git",
    tool: "status",
  });
});
