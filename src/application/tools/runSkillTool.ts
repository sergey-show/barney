import type { SkillPort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export function runSkillTool(
  skills: SkillPort,
  call: ToolCall,
  ctx: { runId: string; open: (name: string, path?: string) => void },
): string {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "");
  const op = call.name.replace(/^plugin_/, "skill_");
  try {
    switch (op) {
      case "skill_list": {
        const listed = skills.list();
        if (!listed.length) return "No plugins installed. Write one with plugin_write if a capability is missing.";
        return listed
          .map((plugin) => `- ${plugin.name} v${plugin.version}${plugin.ui ? " [ui]" : ""}: ${plugin.description}`)
          .join("\n");
      }
      case "skill_write": {
        const plugin = skills.writeFile(str("name"), str("path"), str("content"));
        return `saved plugin:${plugin.name} ${str("path")} (ui=${plugin.ui ?? "none"}) in ~/.barney/plugins/. Reuse with plugin_open.`;
      }
      case "skill_read": {
        const name = str("name");
        const plugin = skills.get(name);
        if (!plugin) return `error: plugin not found: ${name}. plugin_list first.`;
        const rel = str("path").trim();
        if (rel) return skills.readAsset(name, rel);
        const body = plugin.prompt?.trim();
        if (body) return `# ${plugin.name}\n${body}`;
        for (const fallback of ["SKILL.md", "PLUGIN.md"]) {
          try {
            return skills.readAsset(name, fallback);
          } catch {
            /* next */
          }
        }
        return `# ${plugin.name}\n${plugin.description}\n(no SKILL.md)`;
      }
      case "skill_open": {
        const name = str("name");
        const plugin = skills.get(name);
        if (!plugin) return `error: plugin not found: ${name}. plugin_list first, or plugin_write it.`;
        ctx.open(name, str("path") || undefined);
        return plugin.ui
          ? `opened plugin ${name}${str("path") ? ` → ${str("path")}` : ""} in the portal`
          : `opened plugin ${name} (no ui.html — portal will show SKILL.md / PLUGIN.md)`;
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
