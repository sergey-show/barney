import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpPort, McpServer } from "../../application/ports.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

export class FsMcpStore implements McpPort {
  constructor(private readonly root: string) {}

  list(): McpServer[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && NAME.test(entry.name))
      .map((entry) => this.get(entry.name))
      .filter((server): server is McpServer => Boolean(server));
  }

  get(name: string): McpServer | null {
    if (!NAME.test(name)) return null;
    const file = join(this.root, name, "mcp.json");
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<McpServer>;
      return {
        name,
        description: String(parsed.description || name),
        command: String(parsed.command || ""),
        args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
        env: parsed.env && typeof parsed.env === "object" ? parsed.env : undefined,
      };
    } catch {
      return { name, description: name, command: "", args: [] };
    }
  }

  write(input: McpServer): McpServer {
    if (!NAME.test(input.name)) throw new Error("mcp name must be kebab-case, like github-docs");
    const dir = join(this.root, input.name);
    mkdirSync(dir, { recursive: true });
    const saved: McpServer = {
      name: input.name,
      description: input.description.trim() || input.name,
      command: input.command.trim(),
      args: input.args,
      env: input.env,
    };
    writeFileSync(join(dir, "mcp.json"), `${JSON.stringify(saved, null, 2)}\n`, "utf8");
    return saved;
  }
}
