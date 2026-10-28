import type { Run, RunSnapshot } from "../../domain/run/Run.ts";
import type { DomainEvent } from "../../domain/shared/DomainEvent.ts";

export type CreateSessionInput = {
  goal: string;
  agentId?: string;
  cwd?: string;
};

/**
 * Transport-neutral session boundary shared by CLI, Web, and ACP.
 *
 * Presentation adapters depend on this contract rather than orchestrating the
 * kernel directly. Domain Run instances remain internal to the adapter; only
 * immutable snapshots cross the boundary.
 */
export type PromptOpts = {
  replaceFromId?: string;
  whenBusy?: "replace" | "reject" | "steer" | "followUp";
};

export interface AgentSessionApplication {
  create(input: CreateSessionInput): Promise<RunSnapshot>;
  prompt(sessionId: string, text: string, opts?: PromptOpts): Promise<RunSnapshot>;
  resume(sessionId: string, mode?: "continue" | "retry"): Promise<RunSnapshot>;
  compact(sessionId: string): Promise<RunSnapshot>;
  fork(sessionId: string, title?: string): Promise<RunSnapshot>;
  switchBranch(sessionId: string, branchId: string): Promise<RunSnapshot>;
  branches(sessionId: string): Promise<Array<{ id: string; title: string; parentId?: string; active: boolean }>>;
  close(sessionId: string): Promise<RunSnapshot>;
  get(sessionId: string): Promise<RunSnapshot | null>;
  list(): Promise<RunSnapshot[]>;
  cancel(sessionId: string): { ok: boolean };
  isRunning(sessionId: string): boolean;
  subscribe(handler: (event: DomainEvent) => void): () => void;
}

export function snapshotRun(run: Run): RunSnapshot {
  return run.snapshot();
}
