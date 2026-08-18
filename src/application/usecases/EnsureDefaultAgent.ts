import { Agent } from "../../domain/agent/Agent.ts";
import type { AgentRepository } from "../ports.ts";
import { IMMUNE_CONSTITUTION } from "../psyche/design.ts";
import { INSTANCE_NAME } from "../psyche/samost.ts";

export class EnsureDefaultAgent {
  constructor(private readonly agents: AgentRepository) {}

  async execute(): Promise<Agent> {
    const existing = await this.agents.findByName(INSTANCE_NAME);
    if (existing) {
      if (existing.name !== INSTANCE_NAME) {
        existing.name = INSTANCE_NAME;
        await this.agents.save(existing);
      }
      return existing;
    }
    const agent = Agent.create({
      name: INSTANCE_NAME,
      taskClass: "general",
      constitution: IMMUNE_CONSTITUTION,
      skills: [{ kind: "mcp", name: "context7", version: "1" }],
    });
    await this.agents.save(agent);
    return agent;
  }
}
