#!/usr/bin/env bun
/**
 * A sterile probe: one shot, task cwd, no design interview, no body between trials.
 * A fail is a signal. Do not grow src/ around a task name.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryNote } from "../../src/domain/memory/MemoryNote.ts";
import { LlmProvider } from "../../src/domain/provider/LlmProvider.ts";
import { canonDraft, formatDesignNote } from "../../src/application/psyche/design.ts";
import { designKey } from "../../src/application/psyche/keys.ts";
import { EnsureDefaultAgent } from "../../src/application/usecases/EnsureDefaultAgent.ts";
import { Kernel } from "../../src/composition/Kernel.ts";
import type { Run } from "../../src/domain/run/Run.ts";
import type { StartRun } from "../../src/application/usecases/StartRun.ts";
import type { DriveSolve } from "../../src/application/usecases/DriveSolve.ts";

export type HarborModel = {
  name: string;
  kind: "openai-compat" | "anthropic";
  model: string;
  host: string;
  apiKey: string | null;
};

export const EVAL_LLM_BASE =
  process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ||
  process.env.BARNEY_API_BASE?.replace(/\/$/, "") ||
  "http://127.0.0.1:11434/v1";

export function parseHarborModel(spec: string, env: NodeJS.ProcessEnv = process.env): HarborModel {
  const trimmed = spec.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 1) throw new Error("model must be provider/model, e.g. openai/gpt-4.1 or anthropic/claude-sonnet-4-5");
  const name = trimmed.slice(0, slash).toLowerCase();
  const model = trimmed.slice(slash + 1);
  if (name === "anthropic") {
    return {
      name,
      kind: "anthropic",
      model,
      host: env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") || "https://api.anthropic.com/v1/messages",
      apiKey: env.ANTHROPIC_API_KEY || null,
    };
  }
  if (name === "openrouter") {
    return {
      name,
      kind: "openai-compat",
      model,
      host: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || null,
    };
  }
  return {
    name,
    kind: "openai-compat",
    model,
    host: env.OPENAI_BASE_URL || env.BARNEY_API_BASE || defaultHost(name),
    apiKey: env.OPENAI_API_KEY || env.BARNEY_API_KEY || null,
  };
}

function defaultHost(name: string): string {
  if (name === "openai") return "https://api.openai.com/v1";
  if (name === "groq") return "https://api.groq.com/openai/v1";
  return EVAL_LLM_BASE;
}

export function transcriptEvents(run: Run): Array<Record<string, unknown>> {
  return run.transcript.map((item) => ({
    type: "event",
    kind: item.kind,
    text: item.text,
    at: item.at,
    tokens: item.meta?.tokens,
    ms: item.meta?.ms,
    model: item.meta?.model,
  }));
}

type KernelInternals = { startRun: StartRun; driveSolve: DriveSolve };

function internals(kernel: Kernel): KernelInternals {
  return kernel as unknown as KernelInternals;
}

async function main(): Promise<void> {
  // Harbor tasks often target host OS paths (/etc, …). Auto-approve only in this probe.
  process.env.BARNEY_AUTO_APPROVE_OUTSIDE ??= "1";
  const { instruction, modelSpec, home } = parseArgs(process.argv.slice(2));
  const kernel = new Kernel(home);
  const ports = internals(kernel);
  const agent = await new EnsureDefaultAgent(kernel.agents).execute();
  const draft = { ...canonDraft(), language: "en" };
  await kernel.memories.save(new MemoryNote({
    key: designKey(agent.id.value),
    title: "Instance designed",
    body: formatDesignNote(draft),
    tags: ["design", "psyche"],
    sourceAgentId: agent.id.value,
  }));
  await kernel.boot();
  if (modelSpec) await bindModel(kernel, parseHarborModel(modelSpec));

  const created = await ports.startRun.execute({
    goal: instruction,
    agentId: agent.id.value,
    worktreePath: process.cwd(),
  });
  const finished = await ports.driveSolve.execute({
    runId: created.id.value,
    message: instruction,
    forceFull: true,
  });
  const events = transcriptEvents(finished);
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
  process.stdout.write(`${JSON.stringify({
    type: "done",
    status: finished.status,
    tokens: finished.budget.tokensUsed,
    usd: finished.budget.usdUsed,
    worktree: finished.worktreePath,
  })}\n`);
}

export function parseArgs(argv: string[]): { instruction: string; modelSpec: string | undefined; home: string } {
  let modelSpec = process.env.BARNEY_MODEL;
  let home = process.env.BARNEY_HOME || join(homedir(), ".barney");
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      process.stdout.write("bun evals/harbor/run.ts --model provider/model -- <instruction>\n");
      process.exit(0);
    }
    if (arg === "--model" || arg === "-m") {
      modelSpec = argv[++i];
      continue;
    }
    if (arg.startsWith("--model=")) {
      modelSpec = arg.slice(8);
      continue;
    }
    if (arg === "--home") {
      home = argv[++i] ?? home;
      continue;
    }
    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    rest.push(arg);
  }
  const instruction = rest.join(" ").trim();
  if (!instruction) throw new Error("usage: bun evals/harbor/run.ts --model provider/model -- <instruction>");
  return { instruction, modelSpec, home };
}

async function bindModel(kernel: Kernel, spec: HarborModel): Promise<void> {
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

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
