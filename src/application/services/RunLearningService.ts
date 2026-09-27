import {
  admitNewSkill,
  canRewriteSkill,
  parseSkillBody,
  recordSkillOutcome,
  skillBodyKey,
  skillEligibleForLock,
  type SkillBodyRecord,
} from "../context/bodyStability.ts";
import {
  captureHostEnv,
  extractRecalledSkillNames,
  reconsolidateSkill,
} from "../plasticity/plasticity.ts";
import { reshapeProcedureAfterOutcome } from "../context/procedureCompile.ts";
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

export type SkillOutcomeReport = {
  /** Quarantine → verified/frozen and pinned into SkillsLock this turn. */
  promoted: string[];
  /** Verified/frozen (or just-promoted) skill recalled and used on a successful turn. */
  reused: string[];
  /** Verified/frozen skill recalled and used on a failed turn. */
  falseSkills: string[];
};

/**
 * Owns learning side effects produced by a run. Keeping this policy outside
 * DriveSolve makes quarantine, biography, memory, and graph writes auditable
 * as one transaction boundary.
 *
 * Skill loop (target):
 *   recovery mint → quarantine (not in lock)
 *   → recall + use on a later task → reconsolidate / graduate
 *   → verified|frozen → SkillsLock → reusable plugin
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
    // Experience law: only recovery (failed path → different path → success)
    // may mint a quarantine skill. Callers must already gate via decideExperienceWrite.
    const recovered = Boolean(
      lessonTrail.failedFamily
      && lessonTrail.recoveredBy
      && lessonTrail.recoveredBy !== lessonTrail.failedFamily,
    );
    if (!recovered || !klass || klass === "general" || klass === "aborted-unfinished") return "";
    const draft = learnedSkillDraft(klass, {
      failedFamily: lessonTrail.failedFamily,
      recoveredBy: lessonTrail.recoveredBy,
      procedure: lessonTrail.procedure,
    });
    if (!draft) return "";

    const existingBody = await this.memory.get(skillBodyKey(draft.name));
    const bodyRecord = existingBody ? parseSkillBody(existingBody.body, draft.name) : null;
    if (this.skills.get(draft.name) && !canRewriteSkill(bodyRecord)) return draft.name;
    if (!this.skills.get(draft.name)) this.skills.writeFile(draft.name, "SKILL.md", draft.body);

    const admitted = bodyRecord && !canRewriteSkill(bodyRecord)
      ? bodyRecord
      : {
        ...admitNewSkill(draft.name, run.taskClass, klass, captureHostEnv()),
        procedure: lessonTrail.procedure.filter(Boolean).slice(0, 8),
      };
    // Quarantine stays out of SkillsLock until an independent exam (recall+use).
    await this.pinSkillIfEligible(agent, admitted);
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

  /**
   * All skill bodies on disk + any lock entries that only live in memory.
   * Quarantine must be loadable for recall even before SkillsLock pin.
   */
  async loadSkillBodies(agent: Agent): Promise<SkillBodyRecord[]> {
    const byName = new Map<string, SkillBodyRecord>();
    for (const skill of this.skills.list()) {
      const note = await this.memory.get(skillBodyKey(skill.name));
      byName.set(
        skill.name,
        note ? parseSkillBody(note.body, skill.name) : admitNewSkill(skill.name, "general", "general"),
      );
    }
    for (const ref of agent.skillsLock.list()) {
      if (ref.kind !== "skill" || byName.has(ref.name)) continue;
      const note = await this.memory.get(skillBodyKey(ref.name));
      if (note) byName.set(ref.name, parseSkillBody(note.body, ref.name));
    }
    return [...byName.values()];
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

  /** Pin any verified/frozen body that drifted out of the lock (heal + boot). */
  async healSkillLocks(agent: Agent): Promise<number> {
    let pinned = 0;
    const bodies = await this.loadSkillBodies(agent);
    for (const rec of bodies) {
      if (await this.pinSkillIfEligible(agent, rec)) pinned += 1;
    }
    return pinned;
  }

  /**
   * Hebbian exam path: only recalled skills fire.
   * Used+ok (+ optional transfer) graduates quarantine into SkillsLock.
   */
  async applyRecalledSkillOutcomes(
    run: Run,
    agent: Agent,
    input: {
      bags: { skills: string[]; rules: string[] };
      recallHit: boolean;
      recallUsed: boolean;
      success: boolean;
      transfer: boolean;
    },
  ): Promise<SkillOutcomeReport> {
    const promoted: string[] = [];
    const reused: string[] = [];
    const falseSkills: string[] = [];
    const names = extractRecalledSkillNames(input.bags);
    for (const name of names) {
      const note = await this.memory.get(skillBodyKey(name));
      const previous = note
        ? parseSkillBody(note.body, name)
        : admitNewSkill(name, run.taskClass, "general");
      const wasActive = skillEligibleForLock(previous);
      const next = reshapeProcedureAfterOutcome(
        reconsolidateSkill(previous, {
          recalled: input.recallHit,
          used: input.recallUsed,
          outcomeOk: input.success,
          transfer: input.transfer,
        }),
        {
          success: input.success,
          trail: input.recallUsed ? previous.procedure : undefined,
        },
      );
      await this.remember(run, agent.id.value, {
        key: skillBodyKey(name),
        title: `Body: ${name}`,
        body: JSON.stringify(next),
        tags: ["body", "skill", next.status, "plasticity"],
      });
      if (await this.pinSkillIfEligible(agent, next)) {
        promoted.push(name);
        await this.commitBiography(`become: skill ${name} (${next.status})`);
      }
      if (!input.recallUsed) continue;
      const activeNow = skillEligibleForLock(next) || promoted.includes(name);
      if (!activeNow && !wasActive) continue;
      if (input.success) reused.push(name);
      else if (wasActive || skillEligibleForLock(next)) falseSkills.push(name);
    }
    return { promoted, reused, falseSkills };
  }

  /**
   * Legacy lock touch for skills already pinned that were not in recall bags.
   * Prefer applyRecalledSkillOutcomes for the closed exam loop.
   */
  async touchSkillBodies(
    run: Run,
    agent: Agent,
    records: SkillBodyRecord[],
    input: { success: boolean; transfer: boolean; skipNames?: Set<string> },
  ): Promise<void> {
    const byName = new Map(records.map((record) => [record.name, record]));
    const skip = input.skipNames ?? new Set<string>();
    for (const ref of agent.skillsLock.list()) {
      if (ref.kind !== "skill" || skip.has(ref.name)) continue;
      const previous = byName.get(ref.name) ?? admitNewSkill(ref.name, run.taskClass, "general");
      const next = reshapeProcedureAfterOutcome(
        recordSkillOutcome(previous, input),
        { success: input.success, trail: previous.procedure },
      );
      await this.remember(run, agent.id.value, {
        key: skillBodyKey(ref.name),
        title: `Body: ${ref.name}`,
        body: JSON.stringify(next),
        tags: ["body", "skill", next.status],
      });
      await this.pinSkillIfEligible(agent, next);
    }
  }

  async pinSkillIfEligible(agent: Agent, rec: SkillBodyRecord): Promise<boolean> {
    if (!skillEligibleForLock(rec)) return false;
    if (agent.skillsLock.has("skill", rec.name)) return false;
    agent.evolve({ skills: [{ kind: "skill", name: rec.name, version: "1" }] });
    await this.agents.save(agent);
    return true;
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
