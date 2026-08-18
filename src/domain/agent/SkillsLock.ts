import { InvariantError } from "../shared/DomainError.ts";

export type SkillRef = {
  kind: "skill" | "mcp";
  name: string;
  version: string;
};

export class SkillsLock {
  private readonly refs: SkillRef[];

  constructor(refs: SkillRef[] = []) {
    this.refs = [];
    for (const ref of refs) this.pin(ref);
  }

  pin(ref: SkillRef): void {
    if (!ref.name.trim()) throw new InvariantError("skill ref name is required");
    const idx = this.refs.findIndex((r) => r.kind === ref.kind && r.name === ref.name);
    const next = { ...ref, version: ref.version || "1" };
    if (idx >= 0) this.refs[idx] = next;
    else this.refs.push(next);
  }

  has(kind: SkillRef["kind"], name: string): boolean {
    return this.refs.some((r) => r.kind === kind && r.name === name);
  }

  list(): SkillRef[] {
    return this.refs.map((r) => ({ ...r }));
  }

  overlapScore(other: SkillsLock): number {
    if (this.refs.length === 0) return 0;
    const keys = new Set(other.refs.map((r) => `${r.kind}:${r.name}`));
    const hits = this.refs.filter((r) => keys.has(`${r.kind}:${r.name}`)).length;
    return hits / this.refs.length;
  }
}
