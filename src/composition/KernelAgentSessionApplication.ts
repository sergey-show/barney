import type {
  AgentSessionApplication,
  CreateSessionInput,
} from "../application/surfaces/AgentSessionApplication.ts";
import { snapshotRun } from "../application/surfaces/AgentSessionApplication.ts";
import type { RunSnapshot } from "../domain/run/Run.ts";
import type { DomainEvent } from "../domain/shared/DomainEvent.ts";
import type { Kernel } from "./Kernel.ts";

export class KernelAgentSessionApplication implements AgentSessionApplication {
  constructor(private readonly kernel: Kernel) {}

  async create(input: CreateSessionInput): Promise<RunSnapshot> {
    return snapshotRun(await this.kernel.createRun(input.goal, input.agentId, input.cwd));
  }

  async prompt(sessionId: string, text: string): Promise<RunSnapshot> {
    return snapshotRun(await this.kernel.send(sessionId, text));
  }

  async resume(sessionId: string, mode: "continue" | "retry" = "continue"): Promise<RunSnapshot> {
    return snapshotRun(await this.kernel.resume(sessionId, mode));
  }

  async close(sessionId: string): Promise<RunSnapshot> {
    return snapshotRun(await this.kernel.closeSession(sessionId));
  }

  async get(sessionId: string): Promise<RunSnapshot | null> {
    const run = await this.kernel.getRun(sessionId);
    return run ? snapshotRun(run) : null;
  }

  async list(): Promise<RunSnapshot[]> {
    return (await this.kernel.listRuns()).map(snapshotRun);
  }

  cancel(sessionId: string): { ok: boolean } {
    return this.kernel.abortStep(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.kernel.stepRunning(sessionId);
  }

  subscribe(handler: (event: DomainEvent) => void): () => void {
    return this.kernel.events.subscribe(handler);
  }
}
