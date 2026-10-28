import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpConfig, listRemoteMcpUrls } from "./mcpConfig.ts";

test("loadMcpConfig reads enabled stdio servers", () => {
  const home = join(tmpdir(), `barney-mcp-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "mcp.json"), JSON.stringify({
    mcpServers: {
      demo: { command: "npx", args: ["-y", "demo"], enabled: true },
      off: { command: "x", enabled: false },
      remote: { url: "https://example.com/sse" },
    },
  }));
  const servers = loadMcpConfig(home);
  expect(servers).toHaveLength(1);
  expect(servers[0]?.name).toBe("demo");
  expect(listRemoteMcpUrls(home)).toEqual([{ name: "remote", url: "https://example.com/sse" }]);
  rmSync(home, { recursive: true, force: true });
});
