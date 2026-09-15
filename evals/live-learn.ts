#!/usr/bin/env bun
/**
 * Live two-turn probe: one body, openssl on PATH always fails, then a second
 * similar deliverable. Harbor stays sterile; this one keeps memory.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { familyKey } from "../src/application/context/controlLoop.ts";
import { pickRules } from "../src/application/context/lessonRule.ts";
import { canonDraft, constitutionFromDesign, formatDesignNote, samostFromDesign } from "../src/application/psyche/design.ts";
import { designKey, samostKey } from "../src/application/psyche/keys.ts";
import { formatSamost } from "../src/application/psyche/samost.ts";
import { EnsureDefaultAgent } from "../src/application/usecases/EnsureDefaultAgent.ts";
import type { DriveSolve } from "../src/application/usecases/DriveSolve.ts";
import type { StartRun } from "../src/application/usecases/StartRun.ts";
import { Kernel } from "../src/composition/Kernel.ts";
import { MemoryNote } from "../src/domain/memory/MemoryNote.ts";
import { LlmProvider } from "../src/domain/provider/LlmProvider.ts";
import type { Run } from "../src/domain/run/Run.ts";
import { parseHarborModel } from "./harbor/run.ts";

const BAIT = "Create a 2048-bit RSA key with openssl at key.pem. Then write check.py that prints ok and run that script until exit 0.";
const NEXT = "Write runme.py that prints ok and run that script until exit 0.";

type KernelInternals = { startRun: StartRun; driveSolve: DriveSolve };

async function main(): Promise<void> {
  const modelSpec = process.argv.find((arg, i, all) => all[i - 1] === "--model")
    ?? process.env.BARNEY_MODEL
    ?? "local/Qwen3.6-35B-A3B-Hermes-V6";
  const home = mkdtempSync(join(tmpdir(), "barney-live-learn-"));
  const trap = join(home, "trap");
  mkdirSync(trap);
  writeFileSync(join(trap, "openssl"), "#!/bin/sh\necho 'Error: openssl unavailable' >&2\nexit 1\n", { mode: 0o755 });
  chmodSync(join(trap, "openssl"), 0o755);
  process.env.PATH = `${trap}:${process.env.PATH ?? ""}`;

  const kernel = new Kernel(home);
  const ports = kernel as unknown as KernelInternals;
  const draft = { ...canonDraft(), language: "ru" };
  const agent = await new EnsureDefaultAgent(kernel.agents).execute();
  agent.constitution = constitutionFromDesign(draft);
  await kernel.agents.save(agent);
  await kernel.memories.save(new MemoryNote({
    key: designKey(agent.id.value),
    title: "Instance designed",
    body: formatDesignNote(draft),
    tags: ["design", "psyche"],
    sourceAgentId: agent.id.value,
  }));
  await kernel.memories.save(new MemoryNote({
    key: samostKey(agent.id.value),
    title: "Self",
    body: formatSamost(samostFromDesign(draft)),
    tags: ["samost", "psyche"],
    sourceAgentId: agent.id.value,
  }));
  await kernel.boot();
  await bindModel(kernel, parseHarborModel(modelSpec));
  log(`home ${home}`);
  log(`model ${modelSpec}`);

  const off = kernel.events.subscribe((event) => {
    if (event.type === "run.console") log(`tool ${(event.payload as { tool?: string }).tool ?? ""}`);
    if (event.type === "run.act_started") log(`act ${(event.payload as { strategy?: string }).strategy ?? ""}`);
    if (event.type === "run.review_failed" || event.type === "run.reviewed") {
      log(`review ${(event.payload as { verdict?: string }).verdict ?? event.type}`);
    }
  });

  const turn1 = await solve(ports, agent.id.value, home, "turn1", BAIT);
  const notesAfter1 = await kernel.memories.recent(40);
  const rulesAfter = pickRules(notesAfter1, agent.taskClass);
  const lessonAfter1 = notesAfter1.find((note) => note.tags.includes("rule") && note.tags.includes("fail"))
    ?? notesAfter1.find((note) => note.tags.includes("rule"));
  const skill = kernel.plugins.get("learned-unrun-program")
    ?? kernel.plugins.get("learned-missing-artifact")
    ?? kernel.plugins.list().find((item) => item.name.startsWith("learned-"));
  const turn2 = await solve(ports, agent.id.value, home, "turn2", NEXT);
  off();

  const families1 = families(turn1);
  const families2 = families(turn2);
  const lesson = lessonAfter1;
  const report = {
    home,
    model: modelSpec,
    turn1: {
      status: turn1.status,
      families: families1,
      opensslFailed: families1.some((row) => row.family === "shell:openssl" && row.failed),
      pythonRan: families1.some((row) => row.family === "shell:python3" && !row.failed),
    },
    lesson: lesson?.body ?? null,
    rulesInjectedOnTurn2: rulesAfter,
    skill: skill ? { name: skill.name, prompt: skill.prompt.slice(0, 240) } : null,
    turn2: {
      status: turn2.status,
      families: families2,
      calledOpenssl: families2.some((row) => row.family === "shell:openssl"),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const baitTaken = report.turn1.opensslFailed;
  const recovered = report.turn1.pythonRan;
  const learned = Boolean(lesson?.body && /shell:openssl|python3/.test(lesson.body));
  if (!baitTaken) {
    log("verdict: model never called openssl — trail learning was not observed");
    process.exit(2);
  }
  if (!recovered || !learned) {
    log("verdict: bait taken, but no trail lesson after recovery");
    process.exit(1);
  }
  log("verdict: live agent failed openssl, recovered, and wrote a trail lesson");
}

async function solve(ports: KernelInternals, agentId: string, home: string, id: string, instruction: string): Promise<Run> {
  const worktreePath = join(home, "worktrees", id);
  mkdirSync(worktreePath, { recursive: true });
  log(`start ${id}: ${instruction}`);
  const created = await ports.startRun.execute({ goal: instruction, agentId, worktreePath });
  return ports.driveSolve.execute({ runId: created.id.value, message: instruction, forceFull: true });
}

function families(run: Run): Array<{ family: string; failed: boolean; command: string }> {
  const rows: Array<{ family: string; failed: boolean; command: string }> = [];
  for (const item of run.transcript.filter((entry) => entry.kind === "console")) {
    const nl = item.text.indexOf("\n");
    const head = nl < 0 ? item.text : item.text.slice(0, nl);
    const body = nl < 0 ? "" : item.text.slice(nl + 1);
    const space = head.indexOf(" ");
    const name = space < 0 ? head : head.slice(0, space);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(space < 0 ? "{}" : head.slice(space + 1)) as Record<string, unknown>;
    } catch {
      args = {};
    }
    const failed = /^exit [1-9]/.test(body) || /^error:/i.test(body) || /^BLOCKED:/.test(body);
    rows.push({ family: familyKey({ name, arguments: args }), failed, command: String(args.command ?? name).slice(0, 80) });
  }
  return rows;
}

async function bindModel(kernel: Kernel, spec: ReturnType<typeof parseHarborModel>): Promise<void> {
  const existing = await kernel.providers.findByName(spec.name);
  const provider = LlmProvider.create({
    id: existing?.id,
    name: spec.name,
    kind: spec.kind,
    host: spec.host,
    apiKey: spec.apiKey,
    defaultModel: spec.model,
  });
  await kernel.providers.save(provider);
  await kernel.useProvider(provider.id, spec.model);
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
