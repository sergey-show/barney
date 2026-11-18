/**
 * Machine-readable world state after compact — feeds the next turn and appraisal.
 */

import type { CompactFileLists } from "./compactStructured.ts";

export type WorldState = {
  goal: string;
  progress: string[];
  decisions: string[];
  openTasks: string[];
  blockers: string[];
  risks: string[];
  readFiles: string[];
  modifiedFiles: string[];
  nextSteps: string[];
  updatedAt: string;
};

export function emptyWorldState(goal = "", now = new Date().toISOString()): WorldState {
  return {
    goal,
    progress: [],
    decisions: [],
    openTasks: [],
    blockers: [],
    risks: [],
    readFiles: [],
    modifiedFiles: [],
    nextSteps: [],
    updatedAt: now,
  };
}

export function worldStateSystemPrompt(): string {
  return [
    "Summarize this coding session for continuation as BOTH markdown and a final JSON world_state.",
    "Markdown sections:",
    "## Goal",
    "## Progress",
    "## Decisions",
    "## Open tasks / blockers",
    "## Risks",
    "## Read files",
    "## Modified files",
    "## Next steps",
    "Then end with a fenced json block named world_state using keys:",
    "goal, progress[], decisions[], openTasks[], blockers[], risks[], readFiles[], modifiedFiles[], nextSteps[].",
    "Keep bullets short. Prefer concrete paths. Write in the user's language when clear.",
    "Do not invent files or decisions not supported by the transcript.",
  ].join("\n");
}

export function mergeFileListsIntoWorldState(state: WorldState, files: CompactFileLists): WorldState {
  return {
    ...state,
    readFiles: uniqueTail([...state.readFiles, ...files.readFiles], 40),
    modifiedFiles: uniqueTail([...state.modifiedFiles, ...files.modifiedFiles], 40),
    updatedAt: new Date().toISOString(),
  };
}

export function formatWorldStateForPrompt(state: WorldState): string {
  const lines = [
    `goal: ${state.goal || "(none)"}`,
    state.progress.length ? `progress:\n${bullets(state.progress)}` : "",
    state.decisions.length ? `decisions:\n${bullets(state.decisions)}` : "",
    state.openTasks.length ? `open_tasks:\n${bullets(state.openTasks)}` : "",
    state.blockers.length ? `blockers:\n${bullets(state.blockers)}` : "",
    state.risks.length ? `risks:\n${bullets(state.risks)}` : "",
    state.readFiles.length ? `read_files:\n${bullets(state.readFiles)}` : "",
    state.modifiedFiles.length ? `modified_files:\n${bullets(state.modifiedFiles)}` : "",
    state.nextSteps.length ? `next_steps:\n${bullets(state.nextSteps)}` : "",
  ].filter(Boolean);
  return `<world_state>\n${lines.join("\n")}\n</world_state>`;
}

export function parseWorldStateFromCompact(text: string, goal = ""): WorldState {
  const fromJson = parseWorldStateJson(text);
  if (fromJson) {
    return {
      ...fromJson,
      goal: fromJson.goal || goal,
      updatedAt: new Date().toISOString(),
    };
  }
  const state = emptyWorldState(goal);
  state.progress = sectionBullets(text, "Progress");
  state.decisions = sectionBullets(text, "Decisions");
  const open = sectionBullets(text, "Open tasks / blockers");
  state.openTasks = open.filter((line) => !/block/i.test(line));
  state.blockers = open.filter((line) => /block/i.test(line));
  state.risks = sectionBullets(text, "Risks");
  state.readFiles = sectionBullets(text, "Read files");
  state.modifiedFiles = sectionBullets(text, "Modified files");
  state.nextSteps = sectionBullets(text, "Next steps");
  const goalLine = sectionBullets(text, "Goal")[0];
  if (goalLine) state.goal = goalLine;
  return state;
}

function parseWorldStateJson(text: string): WorldState | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    ?? text.match(/\{[\s\S]*"progress"\s*:\s*\[[\s\S]*\}/)?.[0];
  if (!fenced) return null;
  try {
    const raw = JSON.parse(fenced.trim()) as Partial<WorldState>;
    if (!raw || typeof raw !== "object") return null;
    return {
      goal: String(raw.goal ?? ""),
      progress: asStringArray(raw.progress),
      decisions: asStringArray(raw.decisions),
      openTasks: asStringArray(raw.openTasks),
      blockers: asStringArray(raw.blockers),
      risks: asStringArray(raw.risks),
      readFiles: asStringArray(raw.readFiles),
      modifiedFiles: asStringArray(raw.modifiedFiles),
      nextSteps: asStringArray(raw.nextSteps),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function sectionBullets(text: string, title: string): string[] {
  const re = new RegExp(`##\\s*${escapeReg(title)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\n\`\`\`|$)`, "i");
  const body = text.match(re)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 24);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => String(row).trim()).filter(Boolean).slice(0, 40);
}

function bullets(rows: string[]): string {
  return rows.map((row) => `- ${row}`).join("\n");
}

function uniqueTail(rows: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!.trim();
    if (!row || seen.has(row)) continue;
    seen.add(row);
    out.push(row);
    if (out.length >= cap) break;
  }
  return out.reverse();
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
