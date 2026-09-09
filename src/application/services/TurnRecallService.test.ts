import { expect, test } from "bun:test";
import { Episode } from "../../domain/memory/Episode.ts";
import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import type { EpisodeRepository, ExperienceGraph, MemoryRepository } from "../ports.ts";
import { renderConversationalRecall, TurnRecallService } from "./TurnRecallService.ts";

test("recalls a similar episode and autobiographical note with provenance", async () => {
  const prior = episode({
    id: "ep-prior",
    runId: "run-prior",
    goal: "какие задачи запомнились больше всего",
    nextHint: "Short exchange: больше всего запомнились задачи, где пришлось восстановиться после ошибки",
  });
  const current = episode({
    id: "ep-current",
    runId: "run-current",
    goal: "какие задачи запомнились больше всего",
    nextHint: "must not recall the current run",
  });
  const life = new MemoryNote({
    key: "existence/run-prior",
    title: "Existence",
    body: "# Existence\n- act · задачи запомнились после восстановления ошибки",
    tags: ["existence", "psyche", "general"],
    sourceRunId: "run-prior",
    sourceAgentId: "agent-1",
  });
  const unrelated = new MemoryNote({
    key: "note/cooking",
    title: "Рецепт",
    body: "температура духовки и время выпечки",
    tags: ["note"],
    sourceRunId: "run-other",
  });
  const service = new TurnRecallService(
    episodeRepo([current, prior]),
    memoryRepo([unrelated, life]),
    emptyGraph(),
  );

  const recall = await service.load({
    agentId: "agent-1",
    runId: "run-current",
    taskClass: "general",
    query: "какие задачи запомнились больше всего",
  });
  const prompt = renderConversationalRecall(recall);

  expect(recall.relevantEpisodes.map((item) => item.id)).toEqual(["ep-prior"]);
  expect(recall.life.map((item) => item.key)).toEqual(["existence/run-prior"]);
  expect(recall.shared.map((item) => item.key)).not.toContain("note/cooking");
  expect(prompt).toContain("[episode:ep-prior · run:run-prior · success]");
  expect(prompt).toContain("[life:existence/run-prior · run:run-prior]");
  expect(prompt).toContain("Never claim a remembered event unless it appears above");
  expect(prompt).not.toContain("must not recall the current run");
});

test("does not manufacture experience when nothing is relevant", async () => {
  const service = new TurnRecallService(
    episodeRepo([episode({
      id: "ep-unrelated",
      runId: "run-old",
      goal: "настрой nginx",
      nextHint: "configured request logs",
    })]),
    memoryRepo([new MemoryNote({
      key: "note/weather",
      title: "Weather",
      body: "Amsterdam rain",
      tags: ["note"],
    })]),
    emptyGraph(),
  );

  const recall = await service.load({
    agentId: "agent-1",
    runId: "run-new",
    taskClass: "general",
    query: "как ты себя чувствуешь",
  });

  expect(renderConversationalRecall(recall)).toBe("");
});

function episode(input: {
  id: string;
  runId: string;
  goal: string;
  nextHint: string;
}): Episode {
  return new Episode({
    ...input,
    agentId: "agent-1",
    taskClass: "general",
    outcome: "success",
    failureMode: null,
    capabilitiesUsed: ["chat:short"],
    capabilitiesCreated: [],
    markers: [],
    tokens: 0,
    usd: 0,
  });
}

function episodeRepo(items: Episode[]): EpisodeRepository {
  return {
    save: async () => undefined,
    findForAgent: async () => items,
    findFailures: async () => [],
    findByFailureMode: async () => [],
    findRecent: async () => items,
    search: async () => [],
  };
}

function memoryRepo(items: MemoryNote[]): MemoryRepository {
  return {
    save: async (note) => note,
    get: async (idOrKey) => items.find((note) => note.id === idOrKey || note.key === idOrKey) ?? null,
    search: async () => items,
    recent: async () => items,
    remove: async () => false,
  };
}

function emptyGraph(): ExperienceGraph {
  return {
    link: async () => undefined,
    neighborhood: async () => [],
    snapshot: async () => ({ nodes: [], edges: [] }),
  };
}
