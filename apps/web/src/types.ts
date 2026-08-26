export type Agent = { id: string; name: string; version: number; taskClass: string; constitution?: string };
export type ReplyMeta = { tokens: number; ms: number; model: string };
export type Item = { id: string; kind: string; text: string; at: string; meta?: ReplyMeta };
export type Run = {
  id: string;
  goal: string;
  status: string;
  agentId: string;
  transcript: Item[];
  worktreePath: string;
  sessionPath?: string;
  running?: boolean;
  attempts?: number;
};
export type FileEntry = { name: string; path: string; dir: boolean };
export type Provider = { id: string; name: string; kind: string; dialect?: string; baseUrl: string; hasKey: boolean; defaultModel: string | null };
export type Binding = { role: string; providerId: string; model: string };
export type LanePick = { providerId: string; model: string };
export type Lanes = { large: LanePick | null; small: LanePick | null };
export type ProviderState = { providers: Provider[]; bindings: Binding[]; lanes?: Lanes };
export type Plugin = { name: string; version: string; description: string; ui: string | null; mcp?: { command: string } | null };
export type MemoryNote = {
  id: string;
  key: string;
  title: string;
  body: string;
  tags: string[];
  sourceRunId: string;
  sourceAgentId: string;
  createdAt: string;
  updatedAt: string;
  shelf?: "yours" | "learned" | "internal";
};
export type ExperienceNode = { id: string; kind: "class" | "rule" | "plugin" | "note"; title: string; shelf: string };
export type ExperienceEdge = { src: string; dst: string; kind: "failed-as" | "learned" | "recovered-by"; createdAt: string };
export type ExperienceGraph = { nodes: ExperienceNode[]; edges: ExperienceEdge[] };
export type PsycheState = {
  agent: { id: string; name: string; version: number; constitution: string; taskClass: string };
  samost: { compass: string; character: string[]; light: string[]; shadow: string[] };
  designSealed: boolean;
  existence: Array<{ at: string; kind: string; text: string }>;
  board: Array<{ kind: string; text: string }>;
  episodes: Array<{ id: string; runId: string; goal: string; outcome: string; failureMode: string | null; nextHint: string; createdAt: string }>;
};

export function lanesOf(state: ProviderState): Lanes {
  if (state.lanes) return { large: state.lanes.large, small: null };
  const large = state.bindings.find((item) => item.role === "coder");
  return {
    large: large ? { providerId: large.providerId, model: large.model } : null,
    small: null,
  };
}

export function shortModel(name: string): string {
  return name.length > 28 ? `${name.slice(0, 26)}…` : name;
}

export function lastActivity(run: Run): string {
  const last = run.transcript.at(-1)?.at;
  if (!last) return "";
  const date = new Date(last);
  if (Number.isNaN(date.getTime())) return last;
  return date.toLocaleString();
}
