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
import { BusyError, SessionLock } from "./SessionLock.ts";

export { BusyError };

/**
 * Session lifecycle coordinator. It owns cancellation and cleanup so every
 * presentation transport observes the same concurrency semantics.
 */
export class SessionService {
  private readonly lock = new SessionLock();

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

  /**
   * @param lockMode `replace` (default) aborts the previous step — chat UX.
   * @param replaceFromId truncate transcript from this item before prompting (edit/resubmit).
   */
  async prompt(
    runId: string,
    message: string,
    opts?: { lockMode?: "replace" | "reject"; replaceFromId?: string },
  ): Promise<Run> {
    await this.ensureBooted();
    if (opts?.replaceFromId) {
      const run = await this.runs.get(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      if (this.lock.isRunning(runId)) this.lock.cancel(runId);
      this.events.publish(run.truncateFrom(opts.replaceFromId));
      await this.runs.save(run);
    }
    const controller = this.lock.begin(runId, opts?.lockMode ?? "replace");
    try {
      const done = await this.driveSolve.execute({
        runId,
        message: this.mask(message),
        signal: controller.signal,
      });
      this.driveSolve.takeLiveReply(runId);
      return done;
    } catch (error) {
      if (error instanceof BusyError) throw error;
      const run = await this.runs.get(runId);
      if (!run) throw error;
      const aborted = isAbort(error);
      const detail = error instanceof Error ? error.message : String(error);
      const partial = this.driveSolve.takeLiveReply(runId);
      if (run.status === "acting" || run.status === "reviewing" || run.status === "researching") {
        this.events.publish(run.interrupt(
          aborted ? "Step interrupted." : `Error: ${detail}`,
          { partialText: partial || undefined },
        ));
      } else {
        if (partial) {
          run.append("assistant", partial, { tokens: 0, ms: 0, model: "", partial: true });
        }
        run.append("system", aborted ? "Step interrupted." : `Error: ${detail}`);
      }
      await this.runs.save(run);
      return run;
    } finally {
      this.lock.end(runId, controller);
    }
  }

  async compact(runId: string): Promise<Run> {
    await this.ensureBooted();
    const controller = this.lock.begin(runId, "reject");
    try {
      return await this.driveSolve.compact(runId, controller.signal);
    } finally {
      this.lock.end(runId, controller);
    }
  }

  async resume(runId: string, mode: "continue" | "retry" = "continue"): Promise<Run> {
    await this.ensureBooted();
    if (this.lock.isRunning(runId)) throw new BusyError(runId);
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
    return { ok: this.lock.cancel(runId) };
  }

  isRunning(runId: string): boolean {
    return this.lock.isRunning(runId);
  }

  isBusy(): boolean {
    return this.lock.isBusy();
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
