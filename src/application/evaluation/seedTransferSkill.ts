/**
 * Seed a verified/frozen skill into a train home so Four-Hand can measure skill_reuse.
 * Does not bypass invent gate mid-turn — only eval harness writes after train success.
 */

import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import type { Kernel } from "../../composition/Kernel.ts";
import {
  skillBodyKey,
  type SkillBodyRecord,
} from "../context/bodyStability.ts";

export type TransferSkillSeed = {
  name: string;
  klass: string;
  procedure: string[];
  /** Fingerprints that must appear for recall_used (house tokens etc.). */
  fingerprints?: string[];
  skillMd?: string;
};

export async function seedVerifiedTransferSkill(
  kernel: Kernel,
  seed: TransferSkillSeed,
): Promise<SkillBodyRecord> {
  const agent = await kernel.boot();
  const now = new Date().toISOString();
  const record: SkillBodyRecord = {
    name: seed.name,
    status: "frozen",
    wins: 3,
    transfers: 1,
    fails: 0,
    strength: 0.85,
    bornFromClass: seed.klass,
    bornFromMode: seed.klass,
    updatedAt: now,
    lastUsedAt: now,
    lastRecalledAt: now,
    frozenAt: now,
    procedure: seed.procedure,
  };
  const md = seed.skillMd ?? [
    `# ${seed.name}`,
    "",
    `House procedure for ${seed.klass}.`,
    "",
    "## Steps",
    ...seed.procedure.map((step, i) => `${i + 1}. ${step}`),
    "",
    "## Fingerprints",
    ...(seed.fingerprints ?? []).map((fp) => `- \`${fp}\``),
  ].join("\n");

  kernel.skills.writeFile(seed.name, "SKILL.md", md);
  await kernel.memories.save(new MemoryNote({
    key: skillBodyKey(seed.name),
    title: `Body: ${seed.name}`,
    body: JSON.stringify(record),
    tags: ["body", "skill", "frozen", seed.klass, "fourhand-seed"],
    sourceAgentId: agent.id.value,
  }));
  agent.skillsLock.pin({ kind: "skill", name: seed.name, version: "1" });
  await kernel.agents.save(agent);
  return record;
}
