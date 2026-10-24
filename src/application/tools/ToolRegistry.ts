import {
  AGENT_TOOLS,
  type ToolSpec,
} from "../../domain/tools/FileTools.ts";
import type { McpExposure } from "../mcp/mcpConfig.ts";
import { defineTool, toToolSpec, type ToolDefinition } from "./Tool.ts";

const CHILD_DENY = new Set(["agent_spawn", "agent_delegate", "plan_set", "self_rollback"]);

export type McpToolRef = {
  server: string;
  name: string;
  description: string;
  exposure?: McpExposure;
};

export class ToolRegistry {
  private readonly builtins: ToolDefinition[] = [];
  private mcp: McpToolRef[] = [];
  /** Revealed deferred MCP tool full names (mcp__…). */
  private readonly revealed = new Set<string>();

  constructor(seed: ToolSpec[] = AGENT_TOOLS) {
    for (const spec of seed) this.builtins.push(defineTool(spec));
  }

  register(def: ToolDefinition): void {
    const next = defineTool(def);
    const idx = this.builtins.findIndex((t) => t.name === next.name);
    if (idx >= 0) this.builtins[idx] = next;
    else this.builtins.push(next);
  }

  registerMany(defs: ToolDefinition[]): void {
    for (const def of defs) this.register(def);
  }

  /** Replace MCP surface (re-merge after mcp_start / config boot). */
  setMcpTools(tools: McpToolRef[]): void {
    this.mcp = tools;
  }

  /** Reveal deferred MCP tools matching query; returns listing for the model. */
  searchMcp(query: string): string {
    const q = query.trim().toLowerCase();
    const hits: string[] = [];
    for (const tool of this.mcp) {
      const full = mcpToolName(tool.server, tool.name);
      const exposure = tool.exposure ?? "direct";
      if (exposure === "hidden") continue;
      const blob = `${tool.server} ${tool.name} ${tool.description}`.toLowerCase();
      if (q && !blob.includes(q)) continue;
      if (exposure === "deferred" || exposure === "direct") this.revealed.add(full);
      hits.push(`${full} — ${tool.description || tool.name} [${exposure}]`);
    }
    if (!hits.length) return `tool_search: no MCP tools matched ${JSON.stringify(query)}`;
    return `tool_search: revealed ${hits.length}\n${hits.slice(0, 40).join("\n")}`;
  }

  /** Specs exposed to the model for this act depth. */
  specsFor(depth = 0): ToolSpec[] {
    const base = this.builtins
      .map(toToolSpec)
      .filter((t) => depth === 0 || !CHILD_DENY.has(t.name));
    const mcpSpecs = this.mcp
      .filter((tool) => this.mcpVisible(tool))
      .map((tool) =>
        toToolSpec(defineTool({
          name: mcpToolName(tool.server, tool.name),
          description: `MCP ${tool.server}/${tool.name}: ${tool.description || tool.name}`,
          parameters: {
            type: "object",
            properties: {
              arguments: { type: "string", description: "JSON object of tool arguments" },
            },
          },
        })),
      );
    const names = new Set(base.map((t) => t.name));
    return [...base, ...mcpSpecs.filter((t) => !names.has(t.name))];
  }

  listBuiltin(): ToolSpec[] {
    return this.builtins.map(toToolSpec);
  }

  listMcp(): McpToolRef[] {
    return [...this.mcp];
  }

  private mcpVisible(tool: McpToolRef): boolean {
    const exposure = tool.exposure ?? "direct";
    if (exposure === "hidden") return false;
    if (exposure === "direct") return true;
    return this.revealed.has(mcpToolName(tool.server, tool.name));
  }
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${sanitize(server)}__${sanitize(tool)}`;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__([^_].*)__(.+)$/.exec(name) ?? /^mcp__([^_]+)__(.+)$/.exec(name);
  if (!match) {
    // Prefer split on __ after prefix
    if (!name.startsWith("mcp__")) return null;
    const rest = name.slice("mcp__".length);
    const sep = rest.indexOf("__");
    if (sep < 1) return null;
    return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
  }
  return { server: match[1]!, tool: match[2]! };
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
