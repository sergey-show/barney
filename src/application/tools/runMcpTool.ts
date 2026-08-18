import type { McpPort, McpRuntimePort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runMcpTool(
  mcp: McpPort,
  runtime: McpRuntimePort,
  call: ToolCall,
  ctx: { cwd: string; signal?: AbortSignal },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "").trim();
  try {
    switch (call.name) {
      case "mcp_list": {
        const listed = mcp.list();
        const live = runtime.running();
        if (!listed.length && !live.length) {
          return "No MCP recipes. Prefer a skill. If you need a server, mcp_write name/command/args, then mcp_start.";
        }
        const running = new Map(live.map((item) => [item.name, item.tools]));
        const recipes = listed.map((server) => {
          const tools = running.get(server.name);
          const state = tools
            ? `running tools: ${tools.join(", ") || "(none)"}`
            : "recipe only — mcp_start to run";
          return `- ${server.name}: ${server.description}\n  ${server.command} ${server.args.join(" ")}\n  ${state}`.trimEnd();
        });
        const extras = live
          .filter((item) => !listed.some((server) => server.name === item.name))
          .map((item) => `- ${item.name} (running, no recipe on disk) tools: ${item.tools.join(", ")}`);
        return [...recipes, ...extras].join("\n");
      }
      case "mcp_write": {
        const saved = mcp.write({
          name: str("name"),
          description: str("description") || str("name"),
          command: str("command"),
          args: str("args") ? str("args").split(/\s+/).filter(Boolean) : [],
        });
        return `saved mcp:${saved.name} → ~/.barney/plugins/${saved.name}/mcp.json. Next: mcp_start name=${saved.name}.`;
      }
      case "mcp_start": {
        const name = str("name");
        const recipe = mcp.get(name);
        if (!recipe) return `error: no mcp recipe ${name}. mcp_list or mcp_write first.`;
        const started = await runtime.start(recipe, ctx.cwd);
        const tools = started.tools.length
          ? started.tools.map((tool) => `- ${tool.name}: ${tool.description || "(no description)"}`).join("\n")
          : "(no tools listed)";
        return `started mcp:${started.name}\n${tools}\nCall with mcp_call server=${started.name} tool=... arguments={...}`;
      }
      case "mcp_call": {
        const server = str("server") || str("name");
        const tool = str("tool");
        if (!server || !tool) return "error: server and tool are required";
        const raw = args.arguments ?? args.args ?? {};
        const parsed = parseArgs(raw);
        return await runtime.call(server, tool, parsed, ctx.signal);
      }
      case "mcp_stop": {
        const name = str("name") || str("server");
        if (!name) return "error: name is required";
        await runtime.stop(name);
        return `stopped mcp:${name}`;
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { value: raw };
    }
  }
  return {};
}
