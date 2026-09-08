import type { Episode } from "../../domain/memory/Episode.ts";
import type { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import { classKey } from "../../domain/memory/experienceGraph.ts";
import { clipText, redactSecrets } from "../context/packSession.ts";
import { pickRuleNotes, type PickedRule } from "../context/lessonRule.ts";
import { rankBySimilarity } from "../context/semanticRecall.ts";
import type { EpisodeRepository, ExperienceGraph, MemoryRepository } from "../ports.ts";

export type TurnRecallContext = {
  past: Episode[];
  recentAll: Episode[];
  modeEpisodes: Episode[];
  recentMemories: MemoryNote[];
  shared: MemoryNote[];
  life: MemoryNote[];
  relatedKeys: string[];
  hopNotes: MemoryNote[];
  pickedRules: PickedRule[];
  relevantEpisodes: Episode[];
};

/**
 * One recall boundary shared by conversational and tool-using turns.
 * It retrieves evidence; the model may use it, but must not invent a memory
 * that is absent from this context.
 */
export class TurnRecallService {
  constructor(
    private readonly episodes: EpisodeRepository,
    private readonly memory: MemoryRepository,
    private readonly graph: ExperienceGraph,
  ) {}

  async load(input: {
    agentId: string;
    runId: string;
    taskClass: string;
    query: string;
  }): Promise<TurnRecallContext> {
    const [past, recentAll, searched, recentMemories] = await Promise.all([
      this.episodes.findForAgent(input.agentId, input.taskClass),
      this.episodes.findRecent(30),
      this.memory.search(input.query, 8),
      this.memory.recent(80),
    ]);
    const modeHints = [
      ...past.slice(0, 8).map((episode) => episode.failureMode),
      ...recentAll.slice(0, 12).map((episode) => episode.failureMode),
    ].filter((mode): mode is string => Boolean(mode));
    const uniqueModes = [...new Set(modeHints)].slice(0, 4);
    const modeEpisodes = (
      await Promise.all(uniqueModes.map((mode) => this.episodes.findByFailureMode(mode, 6)))
    ).flat();
    const relatedKeys = await this.graph.neighborhood([
      classKey(input.taskClass),
      ...uniqueModes.map((mode) => classKey(mode)),
      ...past.slice(0, 6).flatMap((episode) =>
        episode.failureMode ? [classKey(episode.failureMode)] : []),
    ], 2);
    const hopNotes = (await Promise.all(relatedKeys.map((key) => this.memory.get(key))))
      .filter((note): note is MemoryNote => Boolean(note));
    const pickedRules = pickRuleNotes(
      [...recentMemories, ...hopNotes],
      input.taskClass,
      5,
      relatedKeys,
      uniqueModes,
    );
    const shared = rankNotes(input.query, [...searched, ...recentMemories], 3, (note) =>
      !note.key.startsWith("plan/")
      && !note.key.startsWith("session/")
      && !isPsycheKey(note.key)
      && !note.tags.includes("rule")
      && !note.tags.includes("samost")
      && !note.tags.includes("digest"));
    const life = rankNotes(input.query, recentMemories, 2, (note) =>
      note.tags.includes("existence")
      && note.sourceRunId !== input.runId);
    const relevantEpisodes = rankEpisodes(
      input.query,
      uniqueEpisodes([...past, ...recentAll, ...modeEpisodes])
        .filter((episode) => episode.runId !== input.runId),
      3,
    );
    return {
      past,
      recentAll,
      modeEpisodes,
      recentMemories,
      shared,
      life,
      relatedKeys,
      hopNotes,
      pickedRules,
      relevantEpisodes,
    };
  }
}

export function renderConversationalRecall(
  recall: TurnRecallContext,
  options: { includeRules?: boolean } = {},
): string {
  const lines = [
    ...recall.relevantEpisodes.map((episode) =>
      `- [episode:${episode.id} · run:${episode.runId} · ${episode.outcome}] `
      + `${clipText(episode.goal, 120)} → ${clipText(episode.nextHint, 180)}`),
    ...recall.shared.map((note) =>
      `- [memory:${note.key}${sourceRun(note)}] ${note.title}: ${clipText(note.body, 180)}`),
    ...recall.life.map((note) =>
      `- [life:${note.key}${sourceRun(note)}] ${clipText(note.body, 220)}`),
    ...(options.includeRules === false
      ? []
      : recall.pickedRules.slice(0, 3).map((rule) =>
          `- [rule:${rule.key}] ${clipText(rule.line, 180)}`)),
  ];
  if (!lines.length) return "";
  return [
    "Relevant experience (retrieved from Barney's history; use only when it helps answer this turn):",
    ...lines,
    "Never claim a remembered event unless it appears above or in the current session. Distinguish memory from inference.",
  ].join("\n");
}

function rankNotes(
  query: string,
  notes: MemoryNote[],
  limit: number,
  accept: (note: MemoryNote) => boolean,
): MemoryNote[] {
  const unique = new Map(notes.filter(accept).map((note) => [note.key, note]));
  const ranked = rankBySimilarity(
    query,
    [...unique.values()].map((note) => ({
      key: note.key,
      text: `${note.title}: ${note.body}`,
      tags: [],
    })),
    limit,
  );
  return ranked.map((item) => unique.get(item.key)).filter((note): note is MemoryNote => Boolean(note));
}

function rankEpisodes(query: string, episodes: Episode[], limit: number): Episode[] {
  const byKey = new Map(episodes.map((episode) => [episode.id, episode]));
  return rankBySimilarity(
    query,
    episodes.map((episode) => ({
      key: episode.id,
      text: `${episode.goal} ${episode.nextHint} ${episode.failureMode ?? ""}`,
      tags: [episode.taskClass],
    })),
    limit,
  ).map((item) => byKey.get(item.key)).filter((episode): episode is Episode => Boolean(episode));
}

function uniqueEpisodes(episodes: Episode[]): Episode[] {
  return [...new Map(episodes.map((episode) => [episode.id, episode])).values()];
}

function sourceRun(note: MemoryNote): string {
  return note.sourceRunId ? ` · run:${note.sourceRunId}` : "";
}

function isPsycheKey(key: string): boolean {
  return key.startsWith("samost/") || key.startsWith("existence/") || key.startsWith("board/");
}
