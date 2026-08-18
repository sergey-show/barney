import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsPluginStore } from "./FsPluginStore.ts";

function tempStore() {
  const home = mkdtempSync(join(tmpdir(), "barney-plugins-"));
  const plugins = join(home, "plugins");
  const skills = join(home, "skills");
  const mcp = join(home, "mcp");
  mkdirSync(plugins, { recursive: true });
  mkdirSync(skills, { recursive: true });
  mkdirSync(mcp, { recursive: true });
  return { home, plugins, skills, mcp, store: new FsPluginStore(plugins, { skills, mcp }) };
}

test("write lands in plugins/ with plugin.json", () => {
  const { plugins, store } = tempStore();
  const written = store.writeFile("file-viewer", "ui.html", "<html>ok</html>");
  expect(written.name).toBe("file-viewer");
  expect(written.ui).toBe("ui.html");
  expect(existsSync(join(plugins, "file-viewer/plugin.json"))).toBe(true);
  expect(readFileSync(join(plugins, "file-viewer/plugin.json"), "utf8")).toContain("file-viewer");
  expect(store.list()).toHaveLength(1);
});

test("lists a legacy skill and plugins win on name clash", () => {
  const { plugins, skills, store } = tempStore();
  mkdirSync(join(skills, "old-viewer"), { recursive: true });
  writeFileSync(join(skills, "old-viewer/skill.json"), JSON.stringify({ name: "old-viewer", version: "1", description: "legacy" }));
  writeFileSync(join(skills, "old-viewer/SKILL.md"), "hello from skill");
  expect(store.list().some((item) => item.name === "old-viewer")).toBe(true);
  expect(store.get("old-viewer")?.prompt).toContain("hello from skill");

  mkdirSync(join(plugins, "old-viewer"), { recursive: true });
  writeFileSync(join(plugins, "old-viewer/plugin.json"), JSON.stringify({ name: "old-viewer", version: "2", description: "plugin wins" }));
  writeFileSync(join(plugins, "old-viewer/PLUGIN.md"), "hello from plugin");
  const listed = store.getPlugin("old-viewer");
  expect(listed?.source).toBe("plugins");
  expect(listed?.description).toBe("plugin wins");
  expect(listed?.prompt).toContain("hello from plugin");
});

test("path jail rejects escape", () => {
  const { store } = tempStore();
  expect(() => store.writeFile("file-viewer", "../escape.html", "no")).toThrow(/escapes/);
});

test("mcp write creates plugin.json and mcp.json", () => {
  const { plugins, store } = tempStore();
  const saved = store.write({
    name: "docs",
    description: "docs mcp",
    command: "npx",
    args: ["-y", "foo"],
  });
  expect(saved.command).toBe("npx");
  expect(readFileSync(join(plugins, "docs/mcp.json"), "utf8")).toContain("npx");
  expect(readFileSync(join(plugins, "docs/plugin.json"), "utf8")).toContain("docs mcp");
  expect(store.getMcp("docs")?.command).toBe("npx");
  expect(store.listMcp()).toHaveLength(1);
});

test("loads an AgentSkills SKILL.md without plugin.json", () => {
  const { plugins, store } = tempStore();
  mkdirSync(join(plugins, "pdf-processing"), { recursive: true });
  writeFileSync(join(plugins, "pdf-processing/SKILL.md"), `---
name: pdf-processing
description: Extract text from PDFs
---

Use {baseDir}/scripts/extract.py
`);
  const plugin = store.getPlugin("pdf-processing");
  expect(plugin?.description).toBe("Extract text from PDFs");
  expect(plugin?.prompt).toContain(`${join(plugins, "pdf-processing")}/scripts/extract.py`);
  expect(plugin?.prompt).not.toContain("name: pdf-processing");
});

test("loads a Claude plugin bundle with nested skills and .mcp.json", () => {
  const { plugins, store } = tempStore();
  const root = join(plugins, "devtools");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills/code-review"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify({
    name: "devtools",
    version: "2.0.0",
    description: "dev tools",
  }));
  writeFileSync(join(root, "skills/code-review/SKILL.md"), `---
name: code-review
description: Review a diff
---

Look at the diff.
`);
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({
    mcpServers: {
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    },
  }));
  const names = store.listPlugins().map((plugin) => plugin.name).sort();
  expect(names).toContain("code-review");
  expect(names).toContain("github");
  expect(store.getPlugin("code-review")?.prompt).toContain("Look at the diff");
  expect(store.getMcp("github")?.command).toBe("npx");
  expect(store.getMcp("github")?.args).toContain("@modelcontextprotocol/server-github");
});

test("reads AgentSkills from an extra overlay dir; barney plugins win", () => {
  const { home, store, plugins } = (() => {
    const setup = tempStore();
    const extra = join(setup.home, "claude-skills");
    mkdirSync(join(extra, "git-release"), { recursive: true });
    writeFileSync(join(extra, "git-release/SKILL.md"), `---
name: git-release
description: from claude
---

extra
`);
    const store = new FsPluginStore(setup.plugins, {
      skills: setup.skills,
      mcp: setup.mcp,
      extra: [extra],
    });
    return { ...setup, store };
  })();
  expect(store.getPlugin("git-release")?.description).toBe("from claude");
  mkdirSync(join(plugins, "git-release"), { recursive: true });
  writeFileSync(join(plugins, "git-release/plugin.json"), JSON.stringify({
    name: "git-release",
    version: "9",
    description: "barney copy",
  }));
  writeFileSync(join(plugins, "git-release/SKILL.md"), "barney body");
  expect(store.getPlugin("git-release")?.description).toBe("barney copy");
  expect(store.getPlugin("git-release")?.source).toBe("plugins");
  expect(home).toBeTruthy();
});

