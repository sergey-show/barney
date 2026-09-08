import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import type { Run } from "../../domain/run/Run.ts";
import type {
  AgentRepository,
  BrowserPort,
  EventBus,
  MemoryRepository,
  ProcessPort,
  RunRepository,
} from "../ports.ts";
import type { DriveSolve } from "../usecases/DriveSolve.ts";
import type { StartRun } from "../usecases/StartRun.ts";

/**
 * Session lifecycle coordinator. It owns cancellation and cleanup so every
 * presentation transport observes the same concurrency semantics.
 */
export class SessionService {
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly ensureBooted: () => Promise<unknown>,
    private readonly startRun: StartRun,
    private readonly driveSolve: DriveSolve,
    private readonly runs: RunRepository,
    private readonly agents: AgentRepository,
    private readonly memories: MemoryRepository,
    private readonly browser: BrowserPort,
    private readonly processes: ProcessPort,
    private readonly events: EventBus,
    private readonly mask: (text: string) => string,
  ) {}

  async create(goal: string, agentId?: string, repoDir?: string): Promise<Run> {
    await this.ensureBooted();
    return this.startRun.execute({ goal: this.mask(goal), agentId, repoDir });
  }

  async prompt(runId: string, message: string): Promise<Run> {
    await this.ensureBooted();
    this.inflight.get(runId)?.abort();
    const controller = new AbortController();
    this.inflight.set(runId, controller);
    try {
      return await this.driveSolve.execute({
        runId,
        message: this.mask(message),
        signal: controller.signal,
      });
    } catch (error) {
      const run = await this.runs.get(runId);
      if (!run) throw error;
      const aborted = isAbort(error);
      const detail = error instanceof Error ? error.message : String(error);
      if (run.status === "acting" || run.status === "reviewing" || run.status === "researching") {
        this.events.publish(run.interrupt(aborted ? "Step interrupted." : `Error: ${detail}`));
      } else {
        run.append("system", aborted ? "Step interrupted." : `Error: ${detail}`);
      }
      await this.runs.save(run);
      return run;
    } finally {
      if (this.inflight.get(runId) === controller) this.inflight.delete(runId);
    }
  }

  async resume(runId: string, mode: "continue" | "retry" = "continue"): Promise<Run> {
    await this.ensureBooted();
    if (this.inflight.has(runId)) throw new Error("a step is already running");
    const run = await this.runs.get(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (run.status === "done" || run.status === "parked" || run.status === "failed") {
      throw new Error(`session is ${run.status}`);
    }
    if (run.status === "acting" || run.status === "reviewing" || run.status === "researching") {
      this.events.publish(run.interrupt("Step interrupted before resume."));
      await this.runs.save(run);
    }
    const lastUser = [...run.transcript].reverse().find((item) => item.kind === "user")?.text ?? run.goal;
    const message = mode === "retry"
      ? lastUser
      : `Continue the interrupted work from where you left off.\nLast user request:\n${lastUser}\nDo not redo finished files unless they are broken. Report what is still missing.`;
    return this.prompt(runId, message);
  }

  cancel(runId: string): { ok: boolean } {
    const controller = this.inflight.get(runId);
    if (!controller) return { ok: false };
    controller.abort();
    return { ok: true };
  }

  isRunning(runId: string): boolean {
    return this.inflight.has(runId);
  }

  isBusy(): boolean {
    return this.inflight.size > 0;
  }

  async close(runId: string): Promise<Run> {
    const run = await this.runs.get(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (run.status === "done") return run;
    const agent = await this.agents.get(run.agentId);
    await this.browser.close(runId);
    await this.processes.killRun(runId);
    this.events.publish(run.close());
    if (agent) {
      await this.memories.save(new MemoryNote({
        key: `session/${run.id.value}`,
        title: `Closed: ${run.goal.slice(0, 80)}`,
        body: lastAssistant(run) || "session closed",
        tags: ["session", run.taskClass],
        sourceRunId: run.id.value,
        sourceAgentId: agent.id.value,
      }));
    }
    await this.runs.save(run);
    return run;
  }

  async recoverInterrupted(): Promise<void> {
    for (const run of await this.runs.list()) {
      if (run.status !== "acting" && run.status !== "reviewing" && run.status !== "researching") continue;
      this.events.publish(run.interrupt("Portal restarted; last step was interrupted."));
      await this.runs.save(run);
    }
  }
}

function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof Error)) return false;
  return /abort|interrupted/i.test(`${error.name} ${error.message}`);
}

function lastAssistant(run: Run): string {
  return [...run.transcript].reverse().find((item) => item.kind === "assistant")?.text ?? "";
}
