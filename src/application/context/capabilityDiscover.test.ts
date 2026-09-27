import { expect, test } from "bun:test";
import {
  CAPABILITY_LAW_LINE,
  discoverLedgerFromTranscript,
  emptyDiscoverLedger,
  gateCapabilityWrite,
  noteDiscoverTool,
} from "./capabilityDiscover.ts";

test("blocks invent write without list", () => {
  const hit = gateCapabilityWrite({
    toolName: "mcp_write",
    alreadyExists: false,
    ledger: emptyDiscoverLedger(),
  });
  expect(hit.blocked).toBe(true);
  expect(hit.reason).toMatch(/mcp_list or plugin_list/i);
});

test("blocks invent write after list but without research", () => {
  const ledger = emptyDiscoverLedger();
  noteDiscoverTool(ledger, "mcp_list");
  const hit = gateCapabilityWrite({
    toolName: "mcp_write",
    alreadyExists: false,
    ledger,
  });
  expect(hit.blocked).toBe(true);
  expect(hit.reason).toMatch(/without evidence/i);
});

test("allows invent write after list + web_search", () => {
  const ledger = emptyDiscoverLedger();
  noteDiscoverTool(ledger, "plugin_list");
  noteDiscoverTool(ledger, "web_search", { query: "context7 mcp npx" });
  const hit = gateCapabilityWrite({
    toolName: "mcp_write",
    alreadyExists: false,
    ledger,
  });
  expect(hit.blocked).toBe(false);
});

test("allows new plugin after list without web_search", () => {
  const ledger = emptyDiscoverLedger();
  noteDiscoverTool(ledger, "plugin_list");
  expect(gateCapabilityWrite({
    toolName: "plugin_write",
    alreadyExists: false,
    ledger,
  }).blocked).toBe(false);
});

test("allows update of existing recipe after list only", () => {
  const ledger = emptyDiscoverLedger();
  noteDiscoverTool(ledger, "mcp_list");
  const hit = gateCapabilityWrite({
    toolName: "mcp_write",
    alreadyExists: true,
    ledger,
  });
  expect(hit.blocked).toBe(false);
});

test("transcript rebuild counts research kind and console tools", () => {
  const ledger = discoverLedgerFromTranscript([
    { kind: "console", text: `mcp_list {}\nNo MCP recipes` },
    { kind: "research", text: "DeepResearch brief…" },
  ]);
  expect(ledger.listedBody).toBe(true);
  expect(ledger.researched).toBe(true);
  expect(gateCapabilityWrite({
    toolName: "mcp_write",
    alreadyExists: false,
    ledger,
  }).blocked).toBe(false);
});

test("context7 mcp_call counts as research", () => {
  const ledger = emptyDiscoverLedger();
  noteDiscoverTool(ledger, "mcp_list");
  noteDiscoverTool(ledger, "mcp_call", { server: "context7", tool: "resolve-library-id" });
  expect(ledger.researched).toBe(true);
  expect(CAPABILITY_LAW_LINE).toMatch(/code-enforced/);
});
