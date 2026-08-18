import { event, type DomainEvent } from "../shared/DomainEvent.ts";
import { InvariantError } from "../shared/DomainError.ts";
import { AgentId } from "./AgentId.ts";
import { FormationPolicy, type ExperienceDraft } from "./FormationPolicy.ts";
import { SkillsLock, type SkillRef } from "./SkillsLock.ts";
import { SolvePolicy, type SolvePolicyProps } from "./SolvePolicy.ts";

export type AgentSnapshot = {
  id: string;
  name: string;
  version: number;
  constitution: string;
  taskClass: string;
  skills: SkillRef[];
  solve: SolvePolicyProps;
  sourceRunIds: string[];
};

export class Agent {
  readonly id: AgentId;
  name: string;
  version: number;
  constitution: string;
  taskClass: string;
  readonly skillsLock: SkillsLock;
  readonly solvePolicy: SolvePolicy;
  readonly sourceRunIds: string[];

  private constructor(props: {
    id: AgentId;
    name: string;
    version: number;
    constitution: string;
    taskClass: string;
    skillsLock: SkillsLock;
    solvePolicy: SolvePolicy;
    sourceRunIds: string[];
  }) {
    if (!props.name.trim()) throw new InvariantError("agent name is required");
    this.id = props.id;
    this.name = props.name.trim();
    this.version = props.version;
    this.constitution = props.constitution;
    this.taskClass = props.taskClass;
    this.skillsLock = props.skillsLock;
    this.solvePolicy = props.solvePolicy;
    this.sourceRunIds = [...props.sourceRunIds];
  }

  static create(input: {
    name: string;
    constitution?: string;
    taskClass?: string;
    skills?: SkillRef[];
    solve?: Partial<SolvePolicyProps>;
  }): Agent {
    return new Agent({
      id: AgentId.create(),
      name: input.name,
      version: 1,
      constitution: input.constitution ?? `Instance ${input.name}. Solve the task. Review the step. Do not change the kernel. Do not write a program of the self.`,
      taskClass: input.taskClass ?? "general",
      skillsLock: new SkillsLock(input.skills ?? []),
      solvePolicy: new SolvePolicy(input.solve),
      sourceRunIds: [],
    });
  }

  static formFromExperience(draft: ExperienceDraft, similar: Agent | null): { agent: Agent; decision: "form" | "evolve" | "skip"; events: DomainEvent[] } {
    const decision = new FormationPolicy().decide(draft, similar);
    if (decision === "skip") {
      return { agent: similar ?? Agent.create({ name: draft.name }), decision, events: [event("agent.formation_skipped", { reason: "policy" })] };
    }
    if (decision === "evolve" && similar) {
      similar.evolve({
        constitutionNote: draft.constitution,
        skills: draft.skills.list(),
        sourceRunId: draft.sourceRunId,
      });
      return {
        agent: similar,
        decision,
        events: [event("agent.evolved", { agentId: similar.id.value, runId: draft.sourceRunId })],
      };
    }
    const agent = new Agent({
      id: AgentId.create(),
      name: draft.name,
      version: 1,
      constitution: draft.constitution,
      taskClass: draft.taskClass,
      skillsLock: draft.skills,
      solvePolicy: new SolvePolicy(),
      sourceRunIds: [draft.sourceRunId],
    });
    return {
      agent,
      decision: "form",
      events: [event("agent.formed", { agentId: agent.id.value, runId: draft.sourceRunId, evidence: draft.evidence })],
    };
  }

  evolve(patch: { constitutionNote?: string; skills?: SkillRef[]; sourceRunId?: string }): void {
    this.version += 1;
    if (patch.constitutionNote) {
      this.constitution = `${this.constitution}\n\n# Learned\n${patch.constitutionNote}`.trim();
    }
    for (const skill of patch.skills ?? []) this.skillsLock.pin(skill);
    if (patch.sourceRunId) this.sourceRunIds.push(patch.sourceRunId);
  }

  snapshot(): AgentSnapshot {
    return {
      id: this.id.value,
      name: this.name,
      version: this.version,
      constitution: this.constitution,
      taskClass: this.taskClass,
      skills: this.skillsLock.list(),
      solve: this.solvePolicy.toJSON(),
      sourceRunIds: [...this.sourceRunIds],
    };
  }

  static rehydrate(snap: AgentSnapshot): Agent {
    return new Agent({
      id: AgentId.create(snap.id),
      name: snap.name,
      version: snap.version,
      constitution: snap.constitution,
      taskClass: snap.taskClass,
      skillsLock: new SkillsLock(snap.skills),
      solvePolicy: new SolvePolicy(snap.solve),
      sourceRunIds: snap.sourceRunIds,
    });
  }
}
