import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { PluginInfo, PluginManifest, PluginMcp } from "../../domain/plugin/Plugin.ts";
import { applySkillPlaceholders, parseSkillMd, toPluginName } from "./skillMd.ts";

export function scanPluginRoot(root: string, source: PluginInfo["source"]): PluginInfo[] {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) => discoverBundle(join(root, entry.name), entry.name, source));
}

export function discoverBundle(dir: string, fallbackName: string, source: PluginInfo["source"]): PluginInfo[] {
  if (!dir || !existsSync(dir)) return [];
  const host = readHostManifest(dir, fallbackName);
  const taken = new Set<string>();
  const plugins: PluginInfo[] = [];

  const skillDirs = collectSkillDirs(dir, host.raw);
  for (const skillDir of skillDirs) {
    const mdPath = skillFile(skillDir);
    if (!mdPath) continue;
    const parsed = parseSkillMd(readFileSync(mdPath, "utf8"));
    const wanted = parsed.name || toPluginName(basename(skillDir)) || toPluginName(fallbackName);
    if (!wanted) continue;
    const name = uniqueName(wanted, toPluginName(fallbackName) ?? wanted, taken);
    taken.add(name);
    const prompt = applySkillPlaceholders(parsed.hasFrontmatter ? parsed.body : parsed.body || readFileSync(mdPath, "utf8"), skillDir);
    plugins.push({
      name,
      version: parsed.version || host.version,
      description: parsed.description || host.description || name,
      ui: uiFile(skillDir) ?? (skillDir === dir ? host.ui : undefined),
      dir: skillDir,
      prompt,
      source,
    });
  }

  if (!plugins.length && (host.hasBarney || host.ui || existsSync(join(dir, "PLUGIN.md")))) {
    const name = toPluginName(host.name || fallbackName);
    if (name) {
      taken.add(name);
      plugins.push({
        name,
        version: host.version,
        description: host.description || name,
        ui: host.ui,
        dir,
        prompt: readPrompt(dir),
        source,
      });
    }
  }

  const barneyMcp = asNamedMcp(readJson(join(dir, "mcp.json")), basename(dir), dir)
    ?? (isBarneyMcp(host.raw.mcp) ? asNamedMcp(host.raw.mcp, basename(dir), dir) : undefined);
  const foreignMcp = [
    ...parseMcpServers(readJson(join(dir, ".mcp.json")), dir),
    ...parseMcpServers(host.raw.mcpServers, dir),
    ...parseMcpServers(isBarneyMcp(host.raw.mcp) ? undefined : host.raw.mcp, dir),
  ].filter((item, index, all) => all.findIndex((row) => row.name === item.name && row.command === item.command) === index);

  if (barneyMcp) {
    if (plugins.length === 1 && !plugins[0]!.mcp) plugins[0]!.mcp = barneyMcp;
    else {
      const name = uniqueName(barneyMcp.name, toPluginName(fallbackName) ?? barneyMcp.name, taken);
      taken.add(name);
      plugins.push(mcpPlugin(name, barneyMcp, dir, source, barneyMcp.description || host.description));
    }
  }
  for (const extra of foreignMcp) {
    const name = uniqueName(extra.name, toPluginName(fallbackName) ?? extra.name, taken);
    taken.add(name);
    plugins.push(mcpPlugin(name, extra, dir, source, extra.description || host.description || name));
  }
  return plugins;
}

function mcpPlugin(name: string, mcp: NamedMcp, dir: string, source: PluginInfo["source"], description: string): PluginInfo {
  return {
    name,
    version: "1",
    description: description || name,
    dir,
    prompt: "",
    source,
    mcp: { command: mcp.command, args: mcp.args, env: mcp.env },
  };
}

type NamedMcp = PluginMcp & { name: string; description?: string };

type HostManifest = PluginManifest & {
  raw: Record<string, unknown>;
  hasBarney: boolean;
};

function readHostManifest(dir: string, fallbackName: string): HostManifest {
  const barney = readJson(join(dir, "plugin.json"));
  const skill = readJson(join(dir, "skill.json"));
  const claude = readJson(join(dir, ".claude-plugin/plugin.json"));
  const codex = readJson(join(dir, ".codex-plugin/plugin.json"));
  const claw = readJson(join(dir, "openclaw.plugin.json"));
  const raw = { ...skill, ...claw, ...codex, ...claude, ...barney };
  const name = String(raw.name || fallbackName);
  return {
    name,
    version: String(raw.version || "1"),
    description: String(raw.description || name),
    ui: String(raw.ui || "") || uiFile(dir),
    raw,
    hasBarney: Object.keys(barney).length > 0 || Object.keys(skill).length > 0,
  };
}

function collectSkillDirs(dir: string, raw: Record<string, unknown>): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    if (!path || seen.has(path) || !existsSync(path)) return;
    seen.add(path);
    dirs.push(path);
  };
  if (skillFile(dir)) add(dir);
  addChildren(join(dir, "skills"), add);
  for (const extra of pathList(raw.skills)) {
    const resolved = join(dir, extra.replace(/^\.\//, ""));
    if (skillFile(resolved)) add(resolved);
    else addChildren(resolved, add);
  }
  return dirs;
}

function addChildren(root: string, add: (path: string) => void): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) add(join(root, entry.name));
  }
}

function parseMcpServers(value: unknown, pluginRoot: string): NamedMcp[] {
  if (!value) return [];
  if (typeof value === "string") {
    const file = join(pluginRoot, value.replace(/^\.\//, ""));
    return parseMcpServers(readJson(file), pluginRoot);
  }
  if (typeof value !== "object" || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  if (typeof row.command === "string") {
    const named = asNamedMcp(row, String(row.name || basename(pluginRoot)), pluginRoot);
    return named ? [named] : [];
  }
  const nested = row.mcpServers && typeof row.mcpServers === "object" && !Array.isArray(row.mcpServers)
    ? row.mcpServers as Record<string, unknown>
    : row;
  const out: NamedMcp[] = [];
  for (const [name, spec] of Object.entries(nested)) {
    const named = asNamedMcp(spec, name, pluginRoot);
    if (named) out.push(named);
  }
  return out;
}

function asNamedMcp(value: unknown, name: string, pluginRoot: string): NamedMcp | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const command = typeof row.command === "string" ? applySkillPlaceholders(row.command.trim(), pluginRoot) : "";
  if (!command) return undefined;
  const pluginName = toPluginName(name);
  if (!pluginName) return undefined;
  return {
    name: pluginName,
    description: typeof row.description === "string" ? row.description : undefined,
    command,
    args: Array.isArray(row.args) ? row.args.map((item) => applySkillPlaceholders(String(item), pluginRoot)) : [],
    env: row.env && typeof row.env === "object" && !Array.isArray(row.env)
      ? Object.fromEntries(Object.entries(row.env as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
      : undefined,
  };
}

function skillFile(dir: string): string | null {
  for (const name of ["SKILL.md", "skill.md", "PLUGIN.md"]) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function uiFile(dir: string): string | undefined {
  return existsSync(join(dir, "ui.html")) ? "ui.html" : undefined;
}

function readPrompt(dir: string): string {
  const path = skillFile(dir);
  if (!path) return "";
  const parsed = parseSkillMd(readFileSync(path, "utf8"));
  return applySkillPlaceholders(parsed.body || readFileSync(path, "utf8"), dir);
}

function uniqueName(wanted: string, parent: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  const prefixed = toPluginName(`${parent}-${wanted}`) ?? wanted;
  if (!taken.has(prefixed)) return prefixed;
  let n = 2;
  while (taken.has(`${prefixed}-${n}`)) n += 1;
  return toPluginName(`${prefixed}-${n}`) ?? prefixed;
}

function isBarneyMcp(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { command?: unknown }).command === "string");
}

function pathList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
