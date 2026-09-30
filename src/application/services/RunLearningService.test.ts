import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../../domain/agent/Agent.ts";
import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import { Run } from "../../domain/run/Run.ts";
import { InMemoryEventBus } from "../../infrastructure/events/InMemoryEventBus.ts";
import { FsPluginStore } from "../../infrastructure/plugins/FsPluginStore.ts";
import { SqliteAgentRepository } from "../../infrastructure/persistence/SqliteAgentRepository.ts";
import { SqliteExperienceGraph } from "../../infrastructure/persistence/SqliteExperienceGraph.ts";
import { SqliteMemoryRepository } from "../../infrastructure/persistence/SqliteMemoryRepository.ts";
import { openStore } from "../../infrastructure/persistence/SqliteStore.ts";
import type { HomeRepoPort } from "../ports.ts";
import { admitNewSkill, parseSkillBody, skillBodyKey } from "../context/bodyStability.ts";
import { RunLearningService } from "./RunLearningService.ts";

function silentHome(): HomeRepoPort {
  return {
    ensure: async () => {},
    exportSamost: async () => {},
    commit: async () => "ok",
    status: async () => "",
    log: async () => "",
    rollback: async () => "",
  };
}

test("quarantine skill loads for recall; transfer use promotes into SkillsLock", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-skill-loop-"));
  mkdirSync(join(home, "plugins"), { recursive: true });
  const db = openStore(join(home, "barney.sqlite"));
  const agents = new SqliteAgentRepository(db);
  const memory = new SqliteMemoryRepository(db);
  const skills = new FsPluginStore(join(home, "plugins"));
  const learning = new RunLearningService(
    agents,
    memory,
    new SqliteExperienceGraph(db),
    skills,
    silentHome(),
    new InMemoryEventBus(),
  );

  const agent = Agent.create({ name: "default", taskClass: "sanitize", constitution: "act then review" });
  await agents.save(agent);

  const name = "learned-secret-leak";
  skills.writeFile(name, "SKILL.md", "# recover\nprefer fs_edit over shell\n");
  await memory.save(new MemoryNote({
    key: skillBodyKey(name),
    title: `Body: ${name}`,
    body: JSON.stringify(admitNewSkill(name, "sanitize", "secret-leak")),
    tags: ["body", "skill", "quarantine"],
    sourceAgentId: agent.id.value,
  }));

  const loaded = await learning.loadSkillBodies(agent);
  expect(loaded.some((r) => r.name === name && r.status === "quarantine")).toBe(true);
  expect(agent.skillsLock.has("skill", name)).toBe(false);

  const run = Run.start(agent, {
    goal: "redact secrets with house tokens",
    worktreePath: home,
    taskClass: "sanitize",
  });

  const report = await learning.applyRecalledSkillOutcomes(run, agent, {
    bags: {
      skills: [`[skill:${name}] status=quarantine class=sanitize`],
      rules: [],
    },
    recallHit: true,
    recallUsed: true,
    success: true,
    transfer: true,
  });

  expect(report.promoted).toEqual([name]);
  expect(report.reused).toEqual([name]);
  expect(agent.skillsLock.has("skill", name)).toBe(true);

  const note = await memory.get(skillBodyKey(name));
  expect(note).toBeTruthy();
  expect(parseSkillBody(note!.body, name).status).toBe("frozen");
  expect(await learning.loadQuarantinedSkills()).not.toContain(name);
});

test("healSkillLocks pins verified bodies that missed the lock", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-skill-heal-"));
  mkdirSync(join(home, "plugins"), { recursive: true });
  const db = openStore(join(home, "barney.sqlite"));
  const agents = new SqliteAgentRepository(db);
  const memory = new SqliteMemoryRepository(db);
  const skills = new FsPluginStore(join(home, "plugins"));
  const learning = new RunLearningService(
    agents,
    memory,
    new SqliteExperienceGraph(db),
    skills,
    silentHome(),
    new InMemoryEventBus(),
  );

  const agent = Agent.create({ name: "default", constitution: "act then review" });
  await agents.save(agent);

  const name = "learned-merge";
  skills.writeFile(name, "SKILL.md", "# merge\n");
  await memory.save(new MemoryNote({
    key: skillBodyKey(name),
    title: `Body: ${name}`,
    body: JSON.stringify({ ...admitNewSkill(name, "general", "merge"), status: "verified", wins: 2 }),
    tags: ["body", "skill", "verified"],
    sourceAgentId: agent.id.value,
  }));

  expect(await learning.healSkillLocks(agent)).toBe(1);
  expect(agent.skillsLock.has("skill", name)).toBe(true);
  expect(await learning.healSkillLocks(agent)).toBe(0);
});
