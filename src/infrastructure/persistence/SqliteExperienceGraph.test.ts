import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classKey, memoryShelf, pluginMemoryKey } from "../../domain/memory/experienceGraph.ts";
import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import { openStore } from "../persistence/SqliteStore.ts";
import { SqliteExperienceGraph } from "../persistence/SqliteExperienceGraph.ts";
import { SqliteMemoryRepository } from "../persistence/SqliteMemoryRepository.ts";

test("hop from a fail class reaches a lesson of another task", async () => {
  const dir = mkdtempSync(join(tmpdir(), "barney-graph-"));
  const db = openStore(join(dir, "t.sqlite"));
  const graph = new SqliteExperienceGraph(db);
  const memory = new SqliteMemoryRepository(db);
  await memory.save(new MemoryNote({
    key: "rule/certs/host",
    title: "Run the checker",
    body: "[unrun-program] run the checker; do not repeat the failed call.",
    tags: ["rule", "fail", "certs"],
  }));
  await graph.link(classKey("unrun-program"), "rule/certs/host", "failed-as");
  await graph.link(classKey("unrun-program"), pluginMemoryKey("learned-unrun-program"), "learned");
  const hop = await graph.neighborhood([classKey("unrun-program")], 2);
  expect(hop).toContain("rule/certs/host");
  expect(hop).toContain("plugin/learned-unrun-program");
  const snap = await graph.snapshot();
  expect(snap.nodes.some((node) => node.id === "rule/certs/host" && node.title === "Run the checker")).toBe(true);
  expect(snap.edges.some((edge) => edge.kind === "failed-as")).toBe(true);
});

test("operator notes are yours; psyche keys stay internal", () => {
  expect(memoryShelf({ key: "copy-the-url", tags: ["operator"] })).toBe("yours");
  expect(memoryShelf({ key: "study/ui", tags: ["study", "experience"] })).toBe("learned");
  expect(memoryShelf({ key: "research/host", tags: ["research"] })).toBe("learned");
  expect(memoryShelf({ key: "samost/agent_1", tags: ["samost", "psyche"] })).toBe("internal");
  expect(memoryShelf({ key: "existence/run_1", tags: ["existence"] })).toBe("internal");
});
