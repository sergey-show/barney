import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserPort, HomeRepoPort, LlmPort, McpPort, ResearchPort, TeamPort } from "../ports.ts";
import type { ChatMessage, ChatResult, CompleteOptions, Role } from "../../domain/provider/Role.ts";
import { InMemoryEventBus } from "../../infrastructure/events/InMemoryEventBus.ts";
import { McpRuntime } from "../../infrastructure/mcp/McpRuntime.ts";
import { SqliteAgentRepository } from "../../infrastructure/persistence/SqliteAgentRepository.ts";
import { SqliteEpisodeRepository } from "../../infrastructure/persistence/SqliteEpisodeRepository.ts";
import { SqliteExperienceGraph } from "../../infrastructure/persistence/SqliteExperienceGraph.ts";
import { SqliteMemoryRepository } from "../../infrastructure/persistence/SqliteMemoryRepository.ts";
import { SqliteRunRepository } from "../../infrastructure/persistence/SqliteRunRepository.ts";
import { openStore } from "../../infrastructure/persistence/SqliteStore.ts";
import { ProcessTable } from "../../infrastructure/process/ProcessTable.ts";
import { FsPluginStore } from "../../infrastructure/plugins/FsPluginStore.ts";
import { NodeWorkspace } from "../../infrastructure/workspace/NodeWorkspace.ts";
import { DriveSolve } from "./DriveSolve.ts";
import { EnsureDefaultAgent } from "./EnsureDefaultAgent.ts";
import { StartRun } from "./StartRun.ts";

const GOAL = "Write check.py and run the script until exit 0.";

/**
 * Scripted agent: openssl first unless the kernel already surfaced a lesson
 * about that family. Turn 2 skipping openssl therefore proves the body learned,
 * not that the mock memorized the task.
 */
test("a later run of the same class skips the family that already failed", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-learn-"));
  const { start, drive, memory, skills, llm, agents } = harness(home);
  const agent = await new EnsureDefaultAgent(agents).execute();

  const first = await start.execute({ goal: GOAL, agentId: agent.id.value, worktreePath: worktree(home, "first") });
  const afterFail = await drive.execute({ runId: first.id.value, message: GOAL, forceFull: true });
  const lesson = (await memory.recent(40)).find((note) => note.tags.includes("rule"));

  expect(afterFail.transcript.some((item) => item.kind === "console" && /openssl/.test(item.text) && /exit [1-9]/.test(item.text))).toBe(true);
  expect(afterFail.transcript.some((item) => item.kind === "console" && /python3/.test(item.text) && /\nexit 0/.test(item.text))).toBe(true);
  expect(lesson?.body).toMatch(/shell:openssl.*shell:python3/);

  llm.coderPrompts.length = 0;
  const second = await start.execute({ goal: GOAL, agentId: agent.id.value, worktreePath: worktree(home, "second") });
  const afterLearn = await drive.execute({ runId: second.id.value, message: GOAL, forceFull: true });
  const prompt = llm.coderPrompts.join("\n");

  expect(prompt).toMatch(/Rules from past runs/);
  expect(prompt).toContain("shell:openssl");
  expect(afterLearn.transcript.some((item) => item.kind === "console" && /openssl/.test(item.text))).toBe(false);
  expect(afterLearn.transcript.some((item) => item.kind === "console" && /python3/.test(item.text) && /\nexit 0/.test(item.text))).toBe(true);
}, 20_000);

function harness(home: string) {
  mkdirSync(join(home, "plugins"), { recursive: true });
  const db = openStore(join(home, "barney.sqlite"));
  const events = new InMemoryEventBus();
  const agents = new SqliteAgentRepository(db);
  const runs = new SqliteRunRepository(db, agents);
  const llm = new ScriptedLearner();
  const skills = new FsPluginStore(join(home, "plugins"));
  const memory = new SqliteMemoryRepository(db);
  const start = new StartRun(agents, runs, { create: async (id) => {
    const dir = worktree(home, id);
    return { worktree: dir, sessionDir: dir };
  } }, events);
  const drive = new DriveSolve(
    agents,
    runs,
    new SqliteEpisodeRepository(db),
    llm,
    silentResearch(),
    events,
    (root) => new NodeWorkspace(root, (text) => text),
    skills,
    silentBrowser(),
    memory,
    new SqliteExperienceGraph(db),
    silentMcp(),
    silentTeam(),
    silentHome(),
    new ProcessTable(),
    new McpRuntime(),
  );
  return { start, drive, memory, skills, llm, agents };
}

function worktree(home: string, id: string): string {
  const dest = join(home, "worktrees", id);
  mkdirSync(dest, { recursive: true });
  return dest;
}

class ScriptedLearner implements LlmPort {
  coderPrompts: string[] = [];

  async complete(role: Role, messages: ChatMessage[], options?: CompleteOptions): Promise<ChatResult> {
    if (role === "planner") {
      return json({
        topic: "run check.py",
        short: false,
        need_research: false,
        analysis: "check.py must exist and run with exit 0.",
        plan: ["write check.py", "run it"],
      });
    }
    if (role === "reviewer") {
      const ran = messages.some((item) =>
        item.role === "tool"
        && item.name === "shell"
        && /python3 check\.py/.test(item.content)
        && /^exit 0\b/m.test(item.content),
      );
      if (!ran) {
        return json({
          verdict: "fail",
          achieved: false,
          requested: GOAL,
          missing: "no successful run of check.py",
          summary: "check.py is not proven yet",
          needsResearch: false,
          knowledgeQuery: "",
        });
      }
      return json({
        verdict: "pass",
        achieved: true,
        requested: GOAL,
        missing: "",
        summary: "The requested result appears to be present.",
        needsResearch: false,
        knowledgeQuery: "",
      });
    }
    if (role === "researcher") return json({ ok: true, mismatches: [] });
    if (role !== "coder") return { text: "{}", tokens: 1, usd: 0 };

    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    this.coderPrompts.push(system);
    const learned = /shell:openssl/.test(system);
    const persist = messages.some((item) => item.role === "user" && /Do not give up/.test(item.content));
    const calledOpenssl = messages.some((item) =>
      item.role === "assistant" && item.toolCalls?.some((call) => String(call.arguments?.command ?? "").includes("openssl")),
    );
    const wrote = messages.some((item) => item.role === "tool" && item.name === "fs_write" && !/^error:/i.test(item.content));
    const ran = messages.some((item) => item.role === "tool" && item.name === "shell" && /^exit 0\b/.test(item.content));

    if (!options?.tools?.length) {
      return { text: ran ? "check.py ran with exit 0." : "working", tokens: 8, usd: 0 };
    }
    if (!learned && !persist && !wrote) {
      return tool("fs_write", { path: "check.py", content: "print('ok')\n" });
    }
    if (!learned && !persist && !calledOpenssl) {
      return tool("shell", { command: "openssl this-is-not-a-command" });
    }
    if (!learned && !persist && calledOpenssl && wrote && !ran) {
      return { text: "openssl failed; need another way to prove check.py", tokens: 8, usd: 0 };
    }
    if (!learned && !persist) {
      return { text: "Wrote check.py. openssl failed.", tokens: 8, usd: 0 };
    }
    if (!wrote) return tool("fs_write", { path: "check.py", content: "print('ok')\n" });
    if (!ran) return tool("shell", { command: "python3 check.py" });
    return { text: "Wrote check.py and ran it; exit 0.", tokens: 8, usd: 0 };
  }
}

function json(value: unknown): ChatResult {
  return { text: JSON.stringify(value), tokens: 8, usd: 0 };
}

function tool(name: string, args: Record<string, unknown>): ChatResult {
  return { text: "", toolCalls: [{ id: `t-${name}`, name, arguments: args }], tokens: 8, usd: 0 };
}

function silentResearch(): ResearchPort {
  return { search: async () => "", lookup: async () => [] };
}

function silentMcp(): McpPort {
  return { list: () => [], get: () => null, write: (server) => server };
}

function silentTeam(): TeamPort {
  return {
    list: async () => [],
    spawn: async () => ({ id: "x", name: "x", version: 1, taskClass: "general", skills: [] }),
    delegate: async () => "",
  };
}

function silentHome(): HomeRepoPort {
  return {
    ensure: async () => undefined,
    exportSamost: async () => undefined,
    commit: async () => "",
    status: async () => "",
    log: async () => "",
    rollback: async () => "",
  };
}

function silentBrowser(): BrowserPort {
  const unused = async () => {
    throw new Error("browser not used in self-learn test");
  };
  return {
    open: unused,
    read: unused,
    screenshot: unused as BrowserPort["screenshot"],
    consumeShot: () => null,
    current: () => null,
    click: unused,
    fill: unused,
    press: unused,
    scroll: unused,
    close: async () => undefined,
  };
}
