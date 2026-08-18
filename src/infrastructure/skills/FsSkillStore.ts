import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { SkillInfo, SkillManifest } from "../../domain/skill/Skill.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

export class FsSkillStore {
  constructor(private readonly root: string) {}

  list(): SkillInfo[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && NAME.test(entry.name))
      .map((entry) => this.get(entry.name))
      .filter((skill): skill is SkillInfo => Boolean(skill));
  }

  get(name: string): SkillInfo | null {
    if (!NAME.test(name)) return null;
    const dir = join(this.root, name);
    if (!existsSync(dir)) return null;
    const manifest = this.readManifest(dir, name);
    const prompt = existsSync(join(dir, "SKILL.md")) ? readFileSync(join(dir, "SKILL.md"), "utf8") : "";
    return { ...manifest, dir, prompt };
  }

  writeFile(name: string, rel: string, content: string): SkillInfo {
    if (!NAME.test(name)) throw new Error("skill name must be kebab-case, like file-viewer");
    const dir = join(this.root, name);
    const full = this.resolveSafe(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    if (!existsSync(join(dir, "skill.json"))) {
      const manifest: SkillManifest = {
        name,
        version: "1",
        description: name,
        ui: existsSync(join(dir, "ui.html")) ? "ui.html" : undefined,
      };
      writeFileSync(join(dir, "skill.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
    const skill = this.get(name);
    if (!skill) throw new Error(`skill not saved: ${name}`);
    return skill;
  }

  readAsset(name: string, rel: string): string {
    const skill = this.get(name);
    if (!skill) throw new Error(`skill not found: ${name}`);
    return readFileSync(this.resolveSafe(skill.dir, rel), "utf8");
  }

  private readManifest(dir: string, name: string): SkillManifest {
    const raw = existsSync(join(dir, "skill.json")) ? readFileSync(join(dir, "skill.json"), "utf8") : "";
    try {
      const parsed = JSON.parse(raw || "{}") as Partial<SkillManifest>;
      return {
        name,
        version: String(parsed.version || "1"),
        description: String(parsed.description || name),
        ui: parsed.ui || (existsSync(join(dir, "ui.html")) ? "ui.html" : undefined),
      };
    } catch {
      return { name, version: "1", description: name, ui: existsSync(join(dir, "ui.html")) ? "ui.html" : undefined };
    }
  }

  private resolveSafe(dir: string, rel: string): string {
    const full = resolve(dir, rel || ".");
    const trail = relative(dir, full);
    if (trail.startsWith("..") || trail.includes("\0")) throw new Error("path escapes skill directory");
    return full;
  }
}
