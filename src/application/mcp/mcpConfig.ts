import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "../ports.ts";

/** How MCP tools reach the model. */
export type McpExposure = "direct" | "deferred" | "hidden";

export type McpConfigEntry = {
  /** Local stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Remote SSE URL (future; stdio preferred today) */
  url?: string;
  enabled?: boolean;
  /** direct = always in roster; deferred = after tool_search; hidden = registered only */
  exposure?: McpExposure;
};

export type McpConfigFile = {
  mcpServers?: Record<string, McpConfigEntry>;
  mcp?: Record<string, McpConfigEntry>;
};

export function mcpConfigPath(home: string): string {
  return join(home, "mcp.json");
}

export function loadMcpConfig(home: string): McpServer[] {
  const path = mcpConfigPath(home);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as McpConfigFile;
    const map = raw.mcpServers ?? raw.mcp ?? {};
    const out: McpServer[] = [];
    for (const [name, entry] of Object.entries(map)) {
      if (entry.enabled === false) continue;
      if (entry.url && !entry.command) {
        // SSE remote — recorded but not auto-started until runtime supports it
        continue;
      }
      if (!entry.command?.trim()) continue;
      // hidden servers still boot (runtime), but ToolRegistry may omit tools until tool_search
      out.push({
        name,
        description: "MCP server from config",
        command: entry.command,
        args: entry.args ?? [],
        env: entry.env ?? {},
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function mcpExposureMap(home: string): Record<string, McpExposure> {
  const path = mcpConfigPath(home);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as McpConfigFile;
    const map = raw.mcpServers ?? raw.mcp ?? {};
    const out: Record<string, McpExposure> = {};
    for (const [name, entry] of Object.entries(map)) {
      if (entry.enabled === false) continue;
      out[name] = entry.exposure ?? "direct";
    }
    return out;
  } catch {
    return {};
  }
}

/** Remote SSE entries from mcp.json (not started until SSE transport lands). */
export function listRemoteMcpUrls(home: string): Array<{ name: string; url: string }> {
  const path = mcpConfigPath(home);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as McpConfigFile;
    const map = raw.mcpServers ?? raw.mcp ?? {};
    const out: Array<{ name: string; url: string }> = [];
    for (const [name, entry] of Object.entries(map)) {
      if (entry.enabled === false) continue;
      const url = entry.url?.trim();
      if (!url || entry.command?.trim()) continue;
      out.push({ name, url });
    }
    return out;
  } catch {
    return [];
  }
}