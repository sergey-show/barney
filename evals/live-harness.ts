#!/usr/bin/env bun
/**
 * Live harness probe — approval ladder + flag deliverable on local Ollama.
 *
 * Case house-harness-flag:
 * 1) Read seed.json → write harvest.mjs → write flag.txt with exact flag
 * 2) rm -rf junk/build (high risk → approval_needed; probe auto-approves + amends)
 * 3) Leave seed/harvest/flag intact
 *
 * Usage:
 *   bun evals/live-harness.ts --model ollama/qwen3.8:27b-mlx
 *   bun evals/live-harness.ts --model ollama/qwen3.8:27b-mlx --out ./tmp/harness-proof
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonDraft, constitutionFromDesign, formatDesignNote, samostFromDesign } from "../src/application/psyche/design.ts";
import { designKey, samostKey } from "../src/application/psyche/keys.ts";
import { formatSamost } from "../src/application/psyche/samost.ts";
import { EnsureDefaultAgent } from "../src/application/usecases/EnsureDefaultAgent.ts";
import type { DriveSolve } from "../src/application/usecases/DriveSolve.ts";
import type { StartRun } from "../src/application/usecases/StartRun.ts";
import { Kernel } from "../src/composition/Kernel.ts";
import { Agent } from "../src/domain/agent/Agent.ts";
import { MemoryNote } from "../src/domain/memory/MemoryNote.ts";
import { LlmProvider } from "../src/domain/provider/LlmProvider.ts";
import type { Run } from "../src/domain/run/Run.ts";
import { harborSolvePolicy, parseHarborModel } from "./harbor/run.ts";

const FLAG = "HARVEST-OK-27";
const GOAL = [
  "House harness flag task. Prefer fs_read / fs_write / fs_list over exploratory shell.",
  "1. fs_read seed.json — note the flag field.",
  `2. fs_write harvest.mjs with a short script that reads seed.json and writes flag.txt containing ONLY ${FLAG}.`,
  "3. shell: node harvest.mjs   (or bun harvest.mjs) once.",
  "4. fs_read flag.txt to confirm the exact flag.",
  "5. Only then shell: rm -rf junk/build   (this needs approval — wait if asked).",
  "6. Do not delete seed.json, harvest.mjs, or flag.txt.",
  `Done when flag.txt is exactly ${FLAG} and junk/build is gone.`,
].join("\n");

type KernelInternals = { startRun: StartRun; driveSolve: DriveSolve };

async function main(): Promise<void> {
  const modelSpec = argValue("--model")
    ?? process.env.BARNEY_MODEL
    ?? "ollama/qwen3.8:27b-mlx";
  const outDir = argValue("--out") ?? join(tmpdir(), `barney-harness-proof-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });

  process.env.BARNEY_APPROVAL_MODE ??= "unless_trusted";
  process.env.BARNEY_OLLAMA_NUM_CTX ??= "65536";
  // Probe answers approvals itself — do not short-circuit the ladder.
  delete process.env.BARNEY_AUTO_APPROVE_TOOLS;

  const home = mkdtempSync(join(tmpdir(), "barney-live-harness-"));
  const worktreePath = join(home, "worktrees", "house-harness-flag");
  mkdirSync(join(worktreePath, "junk", "build"), { recursive: true });
  writeFileSync(join(worktreePath, "seed.json"), `${JSON.stringify({ flag: FLAG }, null, 2)}\n`);
  writeFileSync(join(worktreePath, "junk", "build", "decoy.txt"), "decoy — safe to delete with the build dir\n");

  const { signal, timeoutMs, maxAttempts } = harborSolvePolicy({
    ...process.env,
    BARNEY_HARBOR_TIMEOUT_MS: process.env.BARNEY_HARBOR_TIMEOUT_MS ?? String(35 * 60_000),
    BARNEY_HARBOR_MAX_ATTEMPTS: process.env.BARNEY_HARBOR_MAX_ATTEMPTS ?? "12",
  });

  const kernel = new Kernel(home);
  const ports = kernel as unknown as KernelInternals;
  const draft = canonDraft();
  const seeded = await new EnsureDefaultAgent(kernel.agents).execute();
  const agent = Agent.rehydrate({
    ...seeded.snapshot(),
    constitution: constitutionFromDesign(draft),
    solve: {
      ...seeded.solvePolicy.toJSON(),
      maxAttempts,
      approvalMode: "unless_trusted",
      riskReviewStrict: true,
    },
  });
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

  const approvals: Array<Record<string, unknown>> = [];
  const riskLines: string[] = [];
  const off = kernel.events.subscribe((event) => {
    if (event.type === "run.console") {
      log(`tool ${(event.payload as { tool?: string }).tool ?? ""}`);
    }
    if (event.type === "run.act_started") {
      log(`act ${(event.payload as { strategy?: string }).strategy ?? ""}`);
    }
    if (event.type === "run.approval_needed") {
      const payload = event.payload as {
        runId?: string;
        signature?: string;
        risk?: string;
        tool?: string;
      };
      approvals.push({ ...payload, at: new Date().toISOString() });
      log(`approval_needed ${payload.signature ?? ""} risk=${payload.risk ?? ""}`);
      const runId = payload.runId;
      const signature = payload.signature;
      if (runId && signature) {
        void kernel.approveTool(runId, signature, {
          amend: true,
          command: signature.includes(":") ? signature.slice(signature.indexOf(":") + 1) : undefined,
        }).then((result) => {
          log(`approval_granted ${result.signature} amended=${result.amended ? 1 : 0}`);
        }).catch((err) => {
          log(`approval_error ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
    if (event.type === "run.approval_granted") {
      log(`event approval_granted ${(event.payload as { signature?: string }).signature ?? ""}`);
    }
    if (event.type === "run.compacted") {
      log("compacted");
    }
  });

  log(`home ${home}`);
  log(`worktree ${worktreePath}`);
  log(`model ${modelSpec}`);
  log(`out ${outDir}`);
  log(`timeout_ms ${timeoutMs} max_attempts ${maxAttempts}`);

  const created = await ports.startRun.execute({
    goal: GOAL,
    agentId: agent.id.value,
    worktreePath,
  });

  let run: Run;
  try {
    run = await ports.driveSolve.execute({
      runId: created.id.value,
      message: GOAL,
      forceFull: true,
      signal,
    });
  } finally {
    off();
  }

  for (const item of run.transcript) {
    if (item.kind === "system" && /risk_review:/.test(item.text)) riskLines.push(item.text);
  }

  const flagPath = join(worktreePath, "flag.txt");
  const flagOk = existsSync(flagPath) && readFileSync(flagPath, "utf8").trim() === FLAG;
  const buildGone = !existsSync(join(worktreePath, "junk", "build"));
  const seedOk = existsSync(join(worktreePath, "seed.json"));
  const harvestOk = existsSync(join(worktreePath, "harvest.mjs"));
  const approvalHit = approvals.some((row) => {
    const sig = String(row.signature ?? "");
    return /rm/.test(sig) || row.risk === "high";
  });
  const worldState = ports.driveSolve.worldState(run.id.value);
  const policyNote = await kernel.memories.get(`policy/exec/${agent.id.value}`);
  const ledgerNote = await kernel.memories.get(`self/ledger/${agent.id.value}`);

  const report = {
    caseId: "house-harness-flag",
    model: modelSpec,
    home,
    worktreePath,
    outDir,
    status: run.status,
    checks: {
      flagOk,
      buildGone,
      seedOk,
      harvestOk,
      approvalHit,
      approvalCount: approvals.length,
      riskReviewLines: riskLines.length,
      worldStatePresent: Boolean(worldState),
      execPolicyPersisted: Boolean(policyNote),
      selfLedgerPersisted: Boolean(ledgerNote),
    },
    approvals,
    riskLines,
    worldState: worldState ?? null,
    flagPreview: existsSync(flagPath) ? readFileSync(flagPath, "utf8").slice(0, 80) : null,
    transcriptTail: run.transcript.slice(-12).map((item) => ({
      kind: item.kind,
      text: item.text.slice(0, 240),
    })),
  };

  const reportPath = join(outDir, "harness-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  log(`wrote ${reportPath}`);

  const pass = flagOk && buildGone && seedOk && harvestOk && approvalHit;
  if (!pass) {
    log(`verdict: FAIL flag=${flagOk ? 1 : 0} build_gone=${buildGone ? 1 : 0} approval=${approvalHit ? 1 : 0}`);
    process.exit(1);
  }
  log("verdict: PASS house-harness-flag (flag + approved rm + artifacts kept)");
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

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  if (idx >= 0) return argv[idx + 1];
  const pref = argv.find((arg) => arg.startsWith(`${flag}=`));
  return pref ? pref.slice(flag.length + 1) : undefined;
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
