import type { Agent } from "../domain/agent/Agent.ts";
import type { Episode } from "../domain/memory/Episode.ts";
import type { ChatMessage, ChatResult, CompleteOptions, Role } from "../domain/provider/Role.ts";
import type { Run } from "../domain/run/Run.ts";
import type { DomainEvent } from "../domain/shared/DomainEvent.ts";

export interface AgentRepository {
  save(agent: Agent): Promise<void>;
  get(id: string): Promise<Agent | null>;
  findByName(name: string): Promise<Agent | null>;
  findSimilar(taskClass: string, skillNames: string[]): Promise<Agent | null>;
  list(): Promise<Agent[]>;
}

export interface RunRepository {
  save(run: Run): Promise<void>;
  get(id: string): Promise<Run | null>;
  list(): Promise<Run[]>;
}

export interface EpisodeRepository {
  save(episode: Episode): Promise<void>;
  findForAgent(agentId: string, taskClass?: string): Promise<Episode[]>;
  findFailures(taskClass: string, failureMode: string): Promise<Episode[]>;
  findRecent(limit?: number): Promise<Episode[]>;
  search(query: string, limit?: number): Promise<Episode[]>;
}

export interface MemoryRepository {
  save(note: import("../domain/memory/MemoryNote.ts").MemoryNote): Promise<import("../domain/memory/MemoryNote.ts").MemoryNote>;
  get(idOrKey: string): Promise<import("../domain/memory/MemoryNote.ts").MemoryNote | null>;
  search(query: string, limit?: number): Promise<import("../domain/memory/MemoryNote.ts").MemoryNote[]>;
  recent(limit?: number): Promise<import("../domain/memory/MemoryNote.ts").MemoryNote[]>;
  remove(idOrKey: string): Promise<boolean>;
}

export interface ExperienceGraph {
  link(src: string, dst: string, kind: import("../domain/memory/experienceGraph.ts").ExperienceKind): Promise<void>;
  neighborhood(keys: string[], hops?: number): Promise<string[]>;
  snapshot(limit?: number): Promise<{
    nodes: import("../domain/memory/experienceGraph.ts").ExperienceNode[];
    edges: import("../domain/memory/experienceGraph.ts").ExperienceEdge[];
  }>;
}

export type McpServer = {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export interface McpPort {
  list(): McpServer[];
  get(name: string): McpServer | null;
  write(input: McpServer): McpServer;
}

export type TeamAgentView = {
  id: string;
  name: string;
  version: number;
  taskClass: string;
  skills: string[];
};

export interface TeamPort {
  list(): Promise<TeamAgentView[]>;
  spawn(input: { name: string; task: string; skills?: string[] }): Promise<TeamAgentView>;
  delegate(input: { parentRunId: string; agent: string; task: string; signal?: AbortSignal }): Promise<string>;
}

export interface WorktreePort {
  create(runId: string, repoDir?: string): Promise<string>;
}

export interface HomeRepoPort {
  ensure(): Promise<void>;
  exportSamost(body: string): Promise<void>;
  commit(message: string): Promise<string>;
  status(): Promise<string>;
  log(limit?: number): Promise<string>;
  rollback(rev: string): Promise<string>;
}

export type McpToolInfo = { name: string; description: string };

export interface McpRuntimePort {
  start(server: McpServer, cwd?: string): Promise<{ name: string; tools: McpToolInfo[] }>;
  call(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  stop(server: string): Promise<void>;
  running(): Array<{ name: string; tools: string[] }>;
}

export interface ProcessPort {
  spawn(input: { runId: string; cwd: string; command: string; args: string[] }): Promise<{ id: string; pid: number }>;
  list(runId: string): Promise<Array<{ id: string; pid: number; command: string; status: string }>>;
  logs(id: string): Promise<string>;
  kill(id: string): Promise<void>;
  killRun(runId: string): Promise<void>;
}

export interface WorkspacePort {
  list(path?: string): Promise<string>;
  stat(path: string): Promise<string>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<string>;
  edit(path: string, old: string, next: string): Promise<string>;
  append(path: string, content: string): Promise<string>;
  mkdir(path: string): Promise<string>;
  search(query: string, path?: string): Promise<string>;
  remove(path: string): Promise<string>;
  shell(command: string, signal?: AbortSignal): Promise<string>;
}

export interface LlmPort {
  complete(role: Role, messages: ChatMessage[], options?: CompleteOptions): Promise<ChatResult>;
}

export interface ProviderCatalog {
  list(): Promise<import("../domain/provider/LlmProvider.ts").LlmProvider[]>;
  get(id: string): Promise<import("../domain/provider/LlmProvider.ts").LlmProvider | null>;
  findByName(name: string): Promise<import("../domain/provider/LlmProvider.ts").LlmProvider | null>;
  save(provider: import("../domain/provider/LlmProvider.ts").LlmProvider): Promise<void>;
  remove(id: string): Promise<void>;
  bindings(): Promise<import("../domain/provider/LlmProvider.ts").RoleBinding[]>;
  setBinding(role: Role, providerId: string, model: string): Promise<void>;
  setDefault(providerId: string, model: string): Promise<void>;
}

export type ResearchHit = { title: string; url: string; snippet: string };

export interface ResearchPort {
  search(query: string, signal?: AbortSignal): Promise<string>;
  lookup(query: string, signal?: AbortSignal): Promise<ResearchHit[]>;
}

export interface BrowserPort {
  open(input: { runId: string; url: string; signal?: AbortSignal }): Promise<{ title: string; url: string; text: string }>;
  read(runId: string): Promise<{ title: string; url: string; text: string }>;
  screenshot(input: { runId: string; worktree: string; url?: string; fullPage?: boolean; signal?: AbortSignal }): Promise<{ path: string; url: string; title: string; jpeg: Buffer }>;
  consumeShot(runId: string): { path: string; jpeg: Buffer } | null;
  current(runId: string): { url: string } | null;
  click(input: { runId: string; selector?: string; text?: string; signal?: AbortSignal }): Promise<{ title: string; url: string; text: string }>;
  fill(input: { runId: string; selector: string; value: string; signal?: AbortSignal }): Promise<{ title: string; url: string; text: string }>;
  press(input: { runId: string; key: string; signal?: AbortSignal }): Promise<{ title: string; url: string; text: string }>;
  scroll(input: { runId: string; dy?: number; signal?: AbortSignal }): Promise<{ title: string; url: string; text: string }>;
  close(runId: string): Promise<void>;
}

export interface SkillPort {
  list(): import("../domain/skill/Skill.ts").SkillInfo[];
  get(name: string): import("../domain/skill/Skill.ts").SkillInfo | null;
  writeFile(name: string, path: string, content: string): import("../domain/skill/Skill.ts").SkillInfo;
  readAsset(name: string, path: string): string;
}

export interface EventBus {
  publish(events: DomainEvent[]): void;
  subscribe(handler: (event: DomainEvent) => void): () => void;
}

export interface SecretVault {
  store(placeholder: string, value: string): void;
  resolve(placeholder: string): string | undefined;
  reveal(text: string): string;
}

export interface Clock {
  now(): Date;
}
