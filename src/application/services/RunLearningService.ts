import {
  admitNewSkill,
  canRewriteSkill,
  parseSkillBody,
  recordSkillOutcome,
  skillBodyKey,
  type SkillBodyRecord,
} from "../context/bodyStability.ts";
import {
  bumpBacklog,
  failureClass,
  formatBacklog,
  learnedSkillDraft,
  parseBacklog,
} from "../context/failureClass.ts";
import type { LessonTrail } from "../context/lessonRule.ts";
import type {
  AgentRepository,
  EventBus,
  ExperienceGraph,
  HomeRepoPort,
  MemoryRepository,
  SkillPort,
} from "../ports.ts";
import type { Agent } from "../../domain/agent/Agent.ts";
import { classKey, pluginMemoryKey } from "../../domain/memory/experienceGraph.ts";
import { MemoryNote, slugKey } from "../../domain/memory/MemoryNote.ts";
import type { FailureKind } from "../../domain/run/Review.ts";
import type { Run } from "../../domain/run/Run.ts";
import { event } from "../../domain/shared/DomainEvent.ts";

/**
 * Owns learning side effects produced by a run. Keeping this policy outside
 * DriveSolve makes quarantine, biography, memory, and graph writes auditable
 * as one transaction boundary.
 */
export class RunLearningService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly memory: MemoryRepository,
    private readonly graph: ExperienceGraph,
    private readonly skills: SkillPort,
    private readonly home: HomeRepoPort,
    private readonly events: EventBus,
  ) {}

  async closeFailureClass(
    run: Run,
    agent: Agent,
    review: { summary: string; missing?: string; aborted: boolean; failureKind?: FailureKind },
  ): Promise<void> {
    const klass = failureClass({ kind: review.failureKind, aborted: review.aborted });
    const key = slugKey(`backlog/${klass}`);
    const prev = parseBacklog((await this.memory.get(key))?.body ?? "");
    const row = bumpBacklog(prev, klass);
    await this.remember(run, agent.id.value, {
      key,
      title: `Backlog ${klass}`,
      body: formatBacklog(row),
      tags: ["backlog", klass, "fail"],
    });
    await this.graph.link(classKey(klass), key, "failed-as");
  }

  async growBodyFromRecovery(
    run: Run,
    agent: Agent,
    klass: string,
    lessonTrail: LessonTrail,
  ): Promise<string> {
    const recovered = Boolean(
      lessonTrail.failedFamily
      && lessonTrail.recoveredBy
      && lessonTrail.recoveredBy !== lessonTrail.failedFamily,
    );
    if (!recovered || !klass || klass === "general" || klass === "aborted-unfinished") return "";
    const draft = learnedSkillDraft(klass, {
      failedFamily: lessonTrail.failedFamily,
      recoveredBy: lessonTrail.recoveredBy,
    });
    if (!draft) return "";

    const existingBody = await this.memory.get(skillBodyKey(draft.name));
    const bodyRecord = existingBody ? parseSkillBody(existingBody.body, draft.name) : null;
    if (this.skills.get(draft.name) && !canRewriteSkill(bodyRecord)) return draft.name;
    if (!this.skills.get(draft.name)) this.skills.writeFile(draft.name, "SKILL.md", draft.body);

    const admitted = bodyRecord && !canRewriteSkill(bodyRecord)
      ? bodyRecord
      : admitNewSkill(draft.name, run.taskClass, klass);
    // Quarantine is a real execution boundary: only an independently promoted
    // skill may enter the agent's active lock.
    if (admitted.status !== "quarantine") {
      agent.evolve({ skills: [{ kind: "skill", name: draft.name, version: "1" }] });
      await this.agents.save(agent);
    }
    await this.remember(run, agent.id.value, {
      key: skillBodyKey(draft.name),
      title: `Body: ${draft.name}`,
      body: JSON.stringify(admitted),
      tags: ["body", "skill", admitted.status, klass],
    });
    await this.remember(run, agent.id.value, {
      key: `plugin/${draft.name}`,
      title: `Plugin ${draft.name}`,
      body: draft.body,
      tags: ["plugin", "learned", admitted.status, klass],
    });
    await this.graph.link(classKey(klass), pluginMemoryKey(draft.name), "learned");
    await this.graph.link(slugKey(`backlog/${klass}`), pluginMemoryKey(draft.name), "recovered-by");
    await this.commitBiography(`become: skill ${draft.name} (${admitted.status})`);
    return draft.name;
  }

  async loadSkillBodies(agent: Agent): Promise<SkillBodyRecord[]> {
    const records: SkillBodyRecord[] = [];
    for (const ref of agent.skillsLock.list()) {
      if (ref.kind !== "skill") continue;
      const note = await this.memory.get(skillBodyKey(ref.name));
      if (note) records.push(parseSkillBody(note.body, ref.name));
    }
    return records;
  }

  async loadQuarantinedSkills(): Promise<Set<string>> {
    const quarantined = new Set<string>();
    for (const skill of this.skills.list()) {
      const note = await this.memory.get(skillBodyKey(skill.name));
      if (note && parseSkillBody(note.body, skill.name).status === "quarantine") {
        quarantined.add(skill.name);
      }
    }
    return quarantined;
  }

  async touchSkillBodies(
    run: Run,
    agent: Agent,
    records: SkillBodyRecord[],
    input: { success: boolean; transfer: boolean },
  ): Promise<void> {
    const byName = new Map(records.map((record) => [record.name, record]));
    for (const ref of agent.skillsLock.list()) {
      if (ref.kind !== "skill") continue;
      const previous = byName.get(ref.name) ?? admitNewSkill(ref.name, run.taskClass, "general");
      const next = recordSkillOutcome(previous, input);
      await this.remember(run, agent.id.value, {
        key: skillBodyKey(ref.name),
        title: `Body: ${ref.name}`,
        body: JSON.stringify(next),
        tags: ["body", "skill", next.status],
      });
    }
  }

  async remember(
    run: Run,
    agentId: string,
    input: { key: string; title: string; body: string; tags: string[] },
  ): Promise<void> {
    if (!input.body.trim()) return;
    const saved = await this.memory.save(new MemoryNote({
      ...input,
      sourceRunId: run.id.value,
      sourceAgentId: agentId,
    }));
    this.events.publish([event("memory.written", { runId: run.id.value, key: saved.key })]);
  }

  async commitBiography(message: string): Promise<void> {
    try {
      await this.home.commit(message);
    } catch {
      // Biography is best-effort and must not stop the session.
    }
  }
}
