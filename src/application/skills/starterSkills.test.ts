import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsPluginStore } from "../../infrastructure/plugins/FsPluginStore.ts";
import { runSkillTool } from "../tools/runSkillTool.ts";
import { renderSkillCatalog, seedStarterSkills, STARTER_SKILLS } from "./starterSkills.ts";

test("seeds self-hold only and does not overwrite an adapted hold", () => {
  const root = mkdtempSync(join(tmpdir(), "barney-starters-"));
  const store = new FsPluginStore(join(root, "plugins"));
  const first = seedStarterSkills(store);
  expect(first).toEqual(["hold-the-act", "kernel-bound", "no-persona"]);
  expect(STARTER_SKILLS.map((skill) => skill.name)).toEqual(first);
  expect(store.get("hold-the-act")?.prompt).toContain("Wanting");
  expect(store.get("copy-session-url")).toBeNull();
  expect(store.get("research-web")).toBeNull();

  store.writeFile("hold-the-act", "SKILL.md", "---\nname: hold-the-act\ndescription: adapted\n---\n\nагент переписал\n");
  const second = seedStarterSkills(store);
  expect(second).toEqual([]);
  expect(store.get("hold-the-act")?.prompt).toContain("агент переписал");
});

test("catalog indexes every plugin as one line, including self-hold", () => {
  const listed = [
    ...STARTER_SKILLS.map((skill) => ({
      name: skill.name,
      description: skill.description,
      prompt: skill.body,
    })),
    { name: "jira-mcp", description: "user plugin", prompt: "do not dump this recipe" },
  ];
  const catalog = renderSkillCatalog(listed, "найди документацию API");
  expect(catalog).toContain("- hold-the-act:");
  expect(catalog).toContain("- no-persona:");
  expect(catalog).toContain("- jira-mcp:");
  expect(catalog).not.toContain("### hold-the-act");
  expect(catalog).not.toContain(STARTER_SKILLS[0]?.body ?? "Wanting without liking");
  expect(catalog).not.toContain("do not dump this recipe");
  expect(catalog).not.toMatch(/timezone|Session facts|research-web/i);
});

test("plugin_read returns the skill body from the store", () => {
  const root = mkdtempSync(join(tmpdir(), "barney-starters-"));
  const store = new FsPluginStore(join(root, "plugins"));
  seedStarterSkills(store);
  store.writeFile("jira-mcp", "SKILL.md", "---\nname: jira-mcp\n---\n\nUse the Jira REST API.\n");
  const body = runSkillTool(store, { id: "1", name: "plugin_read", arguments: { name: "jira-mcp" } }, { runId: "r", open: () => undefined });
  expect(body).toContain("Use the Jira REST API");
  expect(body).not.toContain("do not dump");
});
