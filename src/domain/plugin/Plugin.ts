import type { SkillInfo } from "../skill/Skill.ts";

export type PluginMcp = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type PluginManifest = {
  name: string;
  version: string;
  description: string;
  ui?: string;
  mcp?: PluginMcp;
};

export type PluginInfo = PluginManifest & {
  dir: string;
  prompt: string;
  source: "plugins" | "skills" | "mcp" | "compat";
};

export function asSkill(plugin: PluginInfo): SkillInfo {
  return {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    ui: plugin.ui,
    dir: plugin.dir,
    prompt: plugin.prompt,
  };
}
