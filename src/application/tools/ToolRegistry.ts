import {
  AGENT_TOOLS,
  type ToolSpec,
} from "../../domain/tools/FileTools.ts";
import { defineTool, toToolSpec, type ToolDefinition } from "./Tool.ts";

const CHILD_DENY = new Set(["agent_spawn", "agent_delegate", "plan_set", "self_rollback"]);

export type McpToolRef = {
  server: string;
  name: string;
  description: string;
};

export class ToolRegistry {
  private readonly builtins: ToolDefinition[] = [];
  private mcp: McpToolRef[] = [];

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

  /** Specs exposed to the model for this act depth. */
  specsFor(depth = 0): ToolSpec[] {
    const base = this.builtins
      .map(toToolSpec)
      .filter((t) => depth === 0 || !CHILD_DENY.has(t.name));
    const mcpSpecs = this.mcp.map((tool) =>
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
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Default registry singleton for composition; Kernel may own its own instance. */
export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry(AGENT_TOOLS);
}
