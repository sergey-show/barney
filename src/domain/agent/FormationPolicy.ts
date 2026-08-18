import type { Episode } from "../memory/Episode.ts";
import type { Agent } from "./Agent.ts";
import type { SkillsLock } from "./SkillsLock.ts";

export type FormationDecision = "form" | "evolve" | "skip";

export type ExperienceDraft = {
  name: string;
  constitution: string;
  taskClass: string;
  skills: SkillsLock;
  sourceRunId: string;
  evidence: string;
  outcome: Episode["outcome"];
  reusable: boolean;
};

export class FormationPolicy {
  decide(draft: ExperienceDraft, similar: Agent | null): FormationDecision {
    if (!draft.reusable) return "skip";
    if (draft.outcome === "fail") return "skip";
    if (!draft.evidence.trim()) return "skip";
    if (draft.skills.list().length === 0 && draft.outcome !== "success") return "skip";
    if (similar && similar.skillsLock.overlapScore(draft.skills) >= 0.5) return "evolve";
    return "form";
  }
}
