import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpRuntime } from "./McpRuntime.ts";

const ECHO_SERVER = String.raw`
const send = (msg) => {
  const json = JSON.stringify(msg);
  const payload = Buffer.from(json);
  process.stdout.write("Content-Length: " + payload.length + "\r\n\r\n");
  process.stdout.write(payload);
};
let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx < 0) break;
    const header = buf.subarray(0, idx).toString();
    const len = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
    if (!Number.isFinite(len) || buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.subarray(idx + 4, idx + 4 + len).toString());
    buf = buf.subarray(idx + 4 + len);
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo text" }] } });
    } else if (msg.method === "tools/call") {
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(msg.params?.arguments?.text ?? "") }] } });
    }
  }
});
process.stdin.resume();
`.trimStart();

test("starts an MCP server over stdio and calls a tool", async () => {
  const dir = mkdtempSync(join(tmpdir(), "barney-mcp-"));
  const script = join(dir, "echo-mcp.cjs");
  writeFileSync(script, ECHO_SERVER);
  const runtime = new McpRuntime();
  const started = await runtime.start({
    name: "echo",
    description: "echo",
    command: process.execPath,
    args: [script],
  }, dir);
  expect(started.tools.map((tool) => tool.name)).toContain("echo");
  expect(await runtime.call("echo", "echo", { text: "harness" })).toBe("harness");
  expect(runtime.running().some((item) => item.name === "echo")).toBe(true);
  await runtime.stop("echo");
  expect(runtime.running()).toEqual([]);
});
