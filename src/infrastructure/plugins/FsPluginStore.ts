import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { McpPort, McpServer, SkillPort } from "../../application/ports.ts";
import { asSkill, type PluginInfo, type PluginManifest, type PluginMcp } from "../../domain/plugin/Plugin.ts";
import type { SkillInfo } from "../../domain/skill/Skill.ts";
import { discoverBundle, scanPluginRoot } from "./discover.ts";
import { toPluginName } from "./skillMd.ts";

export class FsPluginStore implements SkillPort {
  constructor(
    private readonly root: string,
    private readonly overlay: { skills?: string; mcp?: string; extra?: string[] } = {},
  ) {}

  list(): SkillInfo[] {
    return this.listPlugins().map(asSkill);
  }

  get(name: string): SkillInfo | null {
    const plugin = this.getPlugin(name);
    return plugin ? asSkill(plugin) : null;
  }

  writeFile(name: string, rel: string, content: string): SkillInfo {
    const pluginName = toPluginName(name);
    if (!pluginName) throw new Error("plugin name must be kebab-case, like file-viewer");
    const dir = join(this.root, pluginName);
    const full = this.resolveSafe(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    this.ensureManifest(dir, pluginName);
    const plugin = this.getPlugin(pluginName);
    if (!plugin) throw new Error(`plugin not saved: ${pluginName}`);
    return asSkill(plugin);
  }

  readAsset(name: string, rel: string): string {
    const plugin = this.getPlugin(name);
    if (!plugin) throw new Error(`plugin not found: ${name}`);
    return readFileSync(this.resolveSafe(plugin.dir, rel), "utf8");
  }

  listPlugins(): PluginInfo[] {
    const byName = new Map<string, PluginInfo>();
    for (const extra of this.overlay.extra ?? []) {
      for (const plugin of scanPluginRoot(extra, "compat")) byName.set(plugin.name, plugin);
    }
    for (const plugin of scanPluginRoot(this.overlay.mcp ?? "", "mcp")) byName.set(plugin.name, plugin);
    for (const plugin of scanPluginRoot(this.overlay.skills ?? "", "skills")) byName.set(plugin.name, plugin);
    for (const plugin of scanPluginRoot(this.root, "plugins")) byName.set(plugin.name, plugin);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getPlugin(name: string): PluginInfo | null {
    const pluginName = toPluginName(name);
    if (!pluginName) return null;
    return this.listPlugins().find((plugin) => plugin.name === pluginName) ?? null;
  }

  listMcp(): McpServer[] {
    return this.listPlugins()
      .filter((plugin) => plugin.mcp?.command)
      .map((plugin) => ({
        name: plugin.name,
        description: plugin.description,
        command: plugin.mcp!.command,
        args: plugin.mcp!.args,
        env: plugin.mcp!.env,
      }));
  }

  getMcp(name: string): McpServer | null {
    const plugin = this.getPlugin(name);
    if (!plugin?.mcp?.command) return null;
    return {
      name: plugin.name,
      description: plugin.description,
      command: plugin.mcp.command,
      args: plugin.mcp.args,
      env: plugin.mcp.env,
    };
  }

  write(input: McpServer): McpServer {
    const pluginName = toPluginName(input.name);
    if (!pluginName) throw new Error("plugin name must be kebab-case, like github-docs");
    const dir = join(this.root, pluginName);
    mkdirSync(dir, { recursive: true });
    const mcp: PluginMcp = {
      command: input.command.trim(),
      args: input.args,
      env: input.env,
    };
    writeFileSync(join(dir, "mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`, "utf8");
    this.ensureManifest(dir, pluginName, input.description);
    return {
      name: pluginName,
      description: input.description.trim() || pluginName,
      command: mcp.command,
      args: mcp.args,
      env: mcp.env,
    };
  }

  private ensureManifest(dir: string, name: string, description?: string): void {
    const current = discoverBundle(dir, name, "plugins")[0];
    const manifest: PluginManifest = {
      name,
      version: current?.version || "1",
      description: description?.trim() || current?.description || name,
      ui: current?.ui || (existsSync(join(dir, "ui.html")) ? "ui.html" : undefined),
      mcp: current?.mcp,
    };
    writeFileSync(join(dir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (!existsSync(join(dir, "skill.json"))) {
      const { mcp: _mcp, ...skill } = manifest;
      writeFileSync(join(dir, "skill.json"), `${JSON.stringify(skill, null, 2)}\n`, "utf8");
    }
  }

  private resolveSafe(dir: string, rel: string): string {
    const full = resolve(dir, rel || ".");
    const trail = relative(dir, full);
    if (trail.startsWith("..") || trail.includes("\0")) throw new Error("path escapes plugin directory");
    return full;
  }
}

export function mcpView(store: FsPluginStore): McpPort {
  return {
    list: () => store.listMcp(),
    get: (name) => store.getMcp(name),
    write: (input) => store.write(input),
  };
}

export function defaultCompatDirs(home = homedir()): string[] {
  return [
    join(home, ".claude", "skills"),
    join(home, ".config", "opencode", "skills"),
    join(home, ".opencode", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".openclaw", "skills"),
    join(home, ".claw", "skills"),
    join(home, ".codex", "skills"),
  ];
}
