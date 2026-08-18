import { Agent } from "../../domain/agent/Agent.ts";
import { SkillsLock } from "../../domain/agent/SkillsLock.ts";
import type { AgentRepository, EventBus, RunRepository } from "../ports.ts";

export class FormAgentFromRun {
  constructor(
    private readonly agents: AgentRepository,
    private readonly runs: RunRepository,
    private readonly events: EventBus,
  ) {}

  async execute(input: { runId: string; name?: string }): Promise<{ decision: string; agent: Agent }> {
    const run = await this.runs.get(input.runId);
    if (!run) throw new Error(`run not found: ${input.runId}`);
    const current = await this.agents.get(run.agentId);
    const name = input.name ?? slug(`${run.taskClass}-${run.goal}`).slice(0, 40);
    const skills = new SkillsLock(current?.skillsLock.list() ?? []);
    const similar = await this.agents.findSimilar(run.taskClass, skills.list().map((s) => s.name));
    const { agent, decision, events } = Agent.formFromExperience(
      {
        name,
        constitution: `Specialist from session experience, not a character. Goal: ${run.goal}.`,
        taskClass: run.taskClass,
        skills,
        sourceRunId: run.id.value,
        evidence: run.transcript.find((t) => t.kind === "review")?.text ?? run.goal,
        outcome: run.status === "done" ? "success" : run.status === "parked" ? "partial" : "fail",
        reusable: run.status === "done" || run.attempts >= 2,
      },
      similar,
    );
    if (decision !== "skip") await this.agents.save(agent);
    this.events.publish(events);
    run.append("system", `Formation: ${decision} → ${agent.name}`);
    await this.runs.save(run);
    return { decision, agent };
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}
