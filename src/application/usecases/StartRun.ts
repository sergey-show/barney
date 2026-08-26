import { Run } from "../../domain/run/Run.ts";
import { RunId } from "../../domain/run/RunId.ts";
import type { AgentRepository, EventBus, RunRepository, WorktreePort } from "../ports.ts";
import { EnsureDefaultAgent } from "./EnsureDefaultAgent.ts";

export class StartRun {
  constructor(
    private readonly agents: AgentRepository,
    private readonly runs: RunRepository,
    private readonly worktrees: WorktreePort,
    private readonly events: EventBus,
  ) {}

    async execute(input: { goal: string; agentId?: string; repoDir?: string; worktreePath?: string; sessionPath?: string }): Promise<Run> {
    const agent = input.agentId
      ? await this.agents.get(input.agentId)
      : await new EnsureDefaultAgent(this.agents).execute();
    if (!agent) throw new Error(`agent not found: ${input.agentId}`);

    const id = RunId.create();
    const layout = await this.worktrees.create(id.value, input.repoDir);
    const worktreePath = input.worktreePath ?? layout.worktree;
    const sessionPath = input.sessionPath ?? layout.sessionDir;
    const run = Run.start(agent, {
      id,
      goal: input.goal,
      worktreePath,
      sessionPath,
      taskClass: agent.taskClass,
    });
    await this.runs.save(run);
    this.events.publish([
      { type: "run.started", occurredAt: new Date().toISOString(), payload: { runId: run.id.value, agentId: agent.id.value } },
    ]);
    return run;
  }
}
