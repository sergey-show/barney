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

    async execute(input: { goal: string; agentId?: string; repoDir?: string; worktreePath?: string }): Promise<Run> {
    const agent = input.agentId
      ? await this.agents.get(input.agentId)
      : await new EnsureDefaultAgent(this.agents).execute();
    if (!agent) throw new Error(`agent not found: ${input.agentId}`);

    const id = RunId.create();
    const worktreePath = input.worktreePath ?? await this.worktrees.create(id.value, input.repoDir);
    const run = Run.start(agent, {
      id,
      goal: input.goal,
      worktreePath,
      taskClass: agent.taskClass,
    });
    await this.runs.save(run);
    this.events.publish([
      { type: "run.started", occurredAt: new Date().toISOString(), payload: { runId: run.id.value, agentId: agent.id.value } },
    ]);
    return run;
  }
}
