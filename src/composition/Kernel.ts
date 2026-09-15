import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { Agent } from "../domain/agent/Agent.ts";
import { GuardPolicy } from "../domain/guard/GuardPolicy.ts";
import { MemoryNote } from "../domain/memory/MemoryNote.ts";
import type { Run } from "../domain/run/Run.ts";
import { event } from "../domain/shared/DomainEvent.ts";
import { parseBoard } from "../application/psyche/board.ts";
import { appendExistence, formatExistence, parseExistence } from "../application/psyche/existence.ts";
import { nextIdleWork, studyQuery } from "../application/psyche/idleTick.ts";
import {
  agendaMemoryKey,
  formatAgenda,
  gapsFromBacklogRows,
  gapsFromFailEpisodes,
  markAgenda,
  mergeAgenda,
  nextPending,
  parseAgenda,
  proposeAgendaItem,
  type AgendaItem,
} from "../application/autonomy/agenda.ts";
import {
  cancelWakesForRun,
  dueWakes,
  formatWakes,
  markWakeFired,
  parseWakes,
  wakeMemoryKey,
  wakePrompt,
} from "../application/autonomy/wake.ts";
import { parseBacklog } from "../application/context/failureClass.ts";
import {
  needsPlasticSleep,
  planPlasticSleep,
  planSynapseSleep,
  parseSynapse,
  formatSynapse,
  synapseKey,
} from "../application/plasticity/plasticity.ts";
import { parseSkillBody, skillBodyKey } from "../application/context/bodyStability.ts";
import {
  applyDreamHeuristics,
  compressShadowLocally,
  dreamSystemPrompt,
  dreamUserPrompt,
  mergeFailureRules,
  parseDreamHeuristics,
} from "../application/psyche/dream.ts";
import { slugKey } from "../domain/memory/MemoryNote.ts";
import {
  DESIGN_GOAL,
  DESIGN_MARKER,
  DESIGN_PROMPT,
  IMMUNE_CONSTITUTION,
  isDesignGoal,
  isDesignSealed,
  isPersonaConstitution,
} from "../application/psyche/design.ts";
import { boardKey, designKey, existenceKey, samostKey } from "../application/psyche/keys.ts";
import { isRecapLesson, pickRules } from "../application/context/lessonRule.ts";
import { absorbIntoSamost, formatSamost, parseSamost, seedSamost } from "../application/psyche/samost.ts";
import { seedStarterSkills } from "../application/skills/starterSkills.ts";
import { DriveSolve } from "../application/usecases/DriveSolve.ts";
import { EnsureDefaultAgent } from "../application/usecases/EnsureDefaultAgent.ts";
import { FormAgentFromRun } from "../application/usecases/FormAgentFromRun.ts";
import { StartRun } from "../application/usecases/StartRun.ts";
import { SessionService } from "../application/services/SessionService.ts";
import type { TeamAgentView } from "../application/ports.ts";
import { InMemoryEventBus } from "../infrastructure/events/InMemoryEventBus.ts";
import { GitWorktree } from "../infrastructure/git/GitWorktree.ts";
import { HomeRepo } from "../infrastructure/git/HomeRepo.ts";
import { MemoryVault } from "../infrastructure/guard/MemoryVault.ts";
import { RegexSecretScanner } from "../infrastructure/guard/RegexSecretScanner.ts";
import { LlmProvider } from "../domain/provider/LlmProvider.ts";
import { lanesFromBindings } from "../domain/provider/lanes.ts";
import { ROLES } from "../domain/provider/Role.ts";
import { listRemoteModels, RoleRouter, seedBuiltinProviders, seedUnifiedRoleBindings } from "../infrastructure/llm/RoleRouter.ts";
import type { McpPort } from "../application/ports.ts";
import { SqliteAgentRepository } from "../infrastructure/persistence/SqliteAgentRepository.ts";
import { SqliteEpisodeRepository } from "../infrastructure/persistence/SqliteEpisodeRepository.ts";
import { SqliteExperienceGraph } from "../infrastructure/persistence/SqliteExperienceGraph.ts";
import { SqliteMemoryRepository } from "../infrastructure/persistence/SqliteMemoryRepository.ts";
import { memoryShelf } from "../domain/memory/experienceGraph.ts";
import { SqliteProviderCatalog } from "../infrastructure/persistence/SqliteProviderCatalog.ts";
import { SqliteRunRepository } from "../infrastructure/persistence/SqliteRunRepository.ts";
import { openStore } from "../infrastructure/persistence/SqliteStore.ts";
import { ProcessTable } from "../infrastructure/process/ProcessTable.ts";
import { Context7FirstResearch } from "../infrastructure/research/Context7FirstResearch.ts";
import { CompositeResearch, DuckDuckGoSearch } from "../infrastructure/research/webSearch.ts";
import { PlaywrightBrowser } from "../infrastructure/browser/PlaywrightBrowser.ts";
import { FsPluginStore, defaultCompatDirs, mcpView } from "../infrastructure/plugins/FsPluginStore.ts";
import { McpRuntime } from "../infrastructure/mcp/McpRuntime.ts";
import { NodeWorkspace } from "../infrastructure/workspace/NodeWorkspace.ts";
import {
  autoApproveOutside,
  pathAllowedByGrants,
  permissionGrantedMessage,
  permissionPrefix,
} from "../domain/guard/outsideAccess.ts";

export class Kernel {
  readonly home: string;
  readonly events: InMemoryEventBus;
  readonly scanner: RegexSecretScanner;
  private readonly vault: MemoryVault;
  readonly processes: ProcessTable;
  readonly agents: SqliteAgentRepository;
  readonly runs: SqliteRunRepository;
  readonly episodes: SqliteEpisodeRepository;
  readonly memories: SqliteMemoryRepository;
  readonly experience: SqliteExperienceGraph;
  readonly providers: SqliteProviderCatalog;
  readonly plugins: FsPluginStore;
  readonly skills: FsPluginStore;
  readonly mcp: McpPort;
  readonly mcpRuntime: McpRuntime;
  readonly browser: PlaywrightBrowser;
  readonly homeRepo: HomeRepo;
  private readonly llm: RoleRouter;
  private readonly startRun: StartRun;
  private readonly driveSolve: DriveSolve;
  private readonly sessionService: SessionService;
  private readonly formAgent: FormAgentFromRun;
  private readonly ensureAgent: EnsureDefaultAgent;
  private seeded = false;
  private recovered = false;
  private lastIdleAt = 0;
  private lastStudyAt = 0;
  private lastSelfRunAt = 0;
  private lastPlasticSleepAt = 0;
  private readonly research = new CompositeResearch(new Context7FirstResearch(), new DuckDuckGoSearch());
  /** Session grants for fs_* paths outside the worktree (prefix → allowed). */
  private readonly outsideGrants = new Map<string, Set<string>>();

  constructor(home = join(homedir(), ".barney")) {
    this.home = home;
    const db = openStore(join(home, "barney.sqlite"));
    this.events = new InMemoryEventBus();
    this.agents = new SqliteAgentRepository(db);
    this.runs = new SqliteRunRepository(db, this.agents);
    this.episodes = new SqliteEpisodeRepository(db);
    this.memories = new SqliteMemoryRepository(db);
    this.experience = new SqliteExperienceGraph(db);
    this.providers = new SqliteProviderCatalog(db);
    this.processes = new ProcessTable();
    this.processes.onSettled(() => {
      void this.deliverWakes().catch((err) => console.error("wake deliver", err));
    });
    this.vault = new MemoryVault();
    this.scanner = new RegexSecretScanner(new GuardPolicy(), this.vault);
    this.plugins = new FsPluginStore(join(home, "plugins"), {
      skills: join(home, "skills"),
      mcp: join(home, "mcp"),
      extra: defaultCompatDirs(),
    });
    this.skills = this.plugins;
    this.mcp = mcpView(this.plugins);
    this.mcpRuntime = new McpRuntime();
    this.browser = new PlaywrightBrowser();
    this.homeRepo = new HomeRepo(home);
    const worktrees = new GitWorktree(home);
    this.llm = new RoleRouter(this.providers);
    this.startRun = new StartRun(this.agents, this.runs, worktrees, this.events);
    this.driveSolve = new DriveSolve(
      this.agents,
      this.runs,
      this.episodes,
      this.llm,
      this.research,
      this.events,
      (root, runId) => this.workspaceFor(root, runId),
      this.skills,
      this.browser,
      this.memories,
      this.experience,
      this.mcp,
      {
        list: () => this.listTeam(),
        spawn: (input) => this.spawnSpecialist(input),
        delegate: (input) => this.delegateTask(input),
      },
      this.homeRepo,
      this.processes,
      this.mcpRuntime,
    );
    this.sessionService = new SessionService(
      () => this.boot(),
      this.startRun,
      this.driveSolve,
      this.runs,
      this.agents,
      this.memories,
      this.browser,
      this.processes,
      this.events,
      (text) => this.mask(text),
    );
    this.formAgent = new FormAgentFromRun(this.agents, this.runs, this.events);
    this.ensureAgent = new EnsureDefaultAgent(this.agents);
  }

  async boot(): Promise<Agent> {
    if (!this.seeded) {
      await seedBuiltinProviders(this.providers);
      this.seeded = true;
    }
    if (!this.recovered) {
      this.recovered = true;
      await this.sessionService.recoverInterrupted();
    }
    const agent = await this.ensureAgent.execute();
    await this.homeRepo.ensure();
    const seededSkills = seedStarterSkills(this.plugins);
    const designed = await this.memories.get(designKey(agent.id.value));
    if (!isDesignSealed(designed?.body) && isPersonaConstitution(agent.constitution)) {
      agent.constitution = IMMUNE_CONSTITUTION;
      await this.agents.save(agent);
    }
    const existing = await this.memories.get(samostKey(agent.id.value));
    if (!existing) {
      await this.memories.save(new MemoryNote({
        key: samostKey(agent.id.value),
        title: "Self",
        body: formatSamost(seedSamost()),
        tags: ["samost", "psyche"],
        sourceAgentId: agent.id.value,
      }));
    }
    const becomeMsg = !existing
      ? "barney: seed samost"
      : seededSkills.length
        ? "barney: seed starter skills"
        : "barney: boot";
    await this.become(agent.id.value, becomeMsg);
    if (!isDesignSealed(designed?.body)) {
      await this.postDesignSession(agent.id.value);
    }
    return agent;
  }

  async tick(): Promise<string | null> {
    await this.deliverWakes();
    if (this.sessionService.isBusy()) return null;
    if (Date.now() - this.lastIdleAt < 45_000) return null;
    this.lastIdleAt = Date.now();
    const agent = await this.boot();
    const runs = await this.runs.list();
    const open = runs
      .filter((run) => run.status !== "done" && run.status !== "failed")
      .sort((a, b) => (b.transcript.at(-1)?.at ?? "").localeCompare(a.transcript.at(-1)?.at ?? ""))[0];
    const samostNote = await this.memories.get(samostKey(agent.id.value));
    const samost = samostNote ? parseSamost(samostNote.body) : seedSamost();
    const existence = parseExistence(open ? (await this.memories.get(existenceKey(open.id.value)))?.body ?? "" : "");
    const board = parseBoard(open ? (await this.memories.get(boardKey(open.id.value)))?.body ?? "" : "");
    const recent = await this.memories.recent(40);
    const rules = pickRules(recent, agent.taskClass);
    const studied = recent.filter((note) => note.tags.includes("study")).map((note) => `${note.title} ${note.body}`);
    const fails = (await this.episodes.findRecent(12)).filter((episode) => episode.outcome === "fail");
    const lastUserAt = runs
      .flatMap((run) => run.transcript.filter((item) => item.kind === "user"))
      .map((item) => Date.parse(item.at))
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => b - a)[0];
    const agenda = await this.refreshAgenda(agent.id.value, fails, recent);
    const pending = nextPending(agenda);
    const operatorBusy = Boolean(
      open
      && !isDesignGoal(open.goal)
      && !/^Autonomy drill\b/i.test(open.goal),
    );
    const skillNotes = recent.filter((note) => note.tags.includes("body") && note.tags.includes("skill"));
    const skillRecs = skillNotes.map((note) => {
      const name = note.key.replace(/^body\/skill\//, "") || note.title;
      return parseSkillBody(note.body, name);
    });
    const work = nextIdleWork({
      samostPresent: Boolean(samostNote),
      samost,
      existence,
      board,
      rules,
      idleMs: lastUserAt ? Date.now() - lastUserAt : 0,
      failHints: fails.map((episode) => episode.nextHint || episode.goal),
      studied,
      studyCooldownMs: Date.now() - this.lastStudyAt,
      selfRunCooldownMs: Date.now() - this.lastSelfRunAt,
      plasticSleepCooldownMs: Date.now() - this.lastPlasticSleepAt,
      needsPlasticSleep: needsPlasticSleep(skillRecs),
      pendingSelfRun: !operatorBusy && pending
        ? { agendaId: pending.id, goal: pending.goal, failClass: pending.failClass }
        : null,
    });
    if (work.item === "none") return null;
    const designed = await this.memories.get(designKey(agent.id.value));
    if ((work.item === "study" || work.item === "self_run") && !isDesignSealed(designed?.body)) return null;
    if (work.item === "seed_samost") {
      await this.memories.save(new MemoryNote({
        key: samostKey(agent.id.value),
        title: "Self",
        body: formatSamost(seedSamost()),
        tags: ["samost", "psyche"],
        sourceAgentId: agent.id.value,
      }));
    } else if (work.item === "absorb_shadow") {
      if (isRecapLesson(work.rule)) return work.item;
      await this.memories.save(new MemoryNote({
        key: samostKey(agent.id.value),
        title: "Self",
        body: formatSamost(absorbIntoSamost(samost, work.rule, "shadow")),
        tags: ["samost", "psyche"],
        sourceAgentId: agent.id.value,
      }));
    } else if (work.item === "dream") {
      const heuristics = await this.dreamCompress(samost.shadow, rules);
      if (heuristics.length) {
        await this.memories.save(new MemoryNote({
          key: samostKey(agent.id.value),
          title: "Self",
          body: formatSamost(applyDreamHeuristics(samost, heuristics)),
          tags: ["samost", "psyche", "dream"],
          sourceAgentId: agent.id.value,
        }));
      }
    } else if (work.item === "board_to_existence" && open) {
      const next = appendExistence(existence, { kind: "idle", text: work.text });
      await this.memories.save(new MemoryNote({
        key: existenceKey(open.id.value),
        title: "Existence",
        body: formatExistence(next),
        tags: ["existence", "psyche"],
        sourceRunId: open.id.value,
        sourceAgentId: agent.id.value,
      }));
    } else if (work.item === "study") {
      this.lastStudyAt = Date.now();
      const raw = await this.research.search(studyQuery(work.topic));
      const body = raw.replace(/\s+/g, " ").trim().slice(0, 1600);
      await this.memories.save(new MemoryNote({
        key: slugKey(`study/${work.topic}`),
        title: `Study: ${work.topic.slice(0, 80)}`,
        body: body || work.topic,
        tags: ["study", "experience", agent.taskClass],
        sourceAgentId: agent.id.value,
        sourceRunId: open?.id.value ?? "",
      }));
      if (open) {
        await this.memories.save(new MemoryNote({
          key: existenceKey(open.id.value),
          title: "Existence",
          body: formatExistence(appendExistence(existence, { kind: "idle", text: `studied: ${work.topic.slice(0, 140)}` })),
          tags: ["existence", "psyche"],
          sourceRunId: open.id.value,
          sourceAgentId: agent.id.value,
        }));
      }
    } else if (work.item === "self_run") {
      await this.runAutonomyDrill(agent.id.value, work.agendaId, work.goal, work.failClass);
    } else if (work.item === "plastic_sleep") {
      await this.runPlasticSleep(agent.id.value, skillRecs, recent);
    }
    if (
      work.item === "seed_samost"
      || work.item === "absorb_shadow"
      || work.item === "dream"
      || work.item === "study"
      || work.item === "self_run"
      || work.item === "plastic_sleep"
    ) {
      await this.become(agent.id.value, `become: idle ${work.item}`);
    }
    this.events.publish([event("psyche.tick", { item: work.item })]);
    return work.item;
  }

  /** Deliver due wakes; may resume at most one free session per call. */
  async deliverWakes(): Promise<string | null> {
    const agent = (await this.agents.list())[0];
    if (!agent) return null;
    const key = wakeMemoryKey(agent.id.value);
    let items = parseWakes((await this.memories.get(key))?.body ?? "");
    if (!items.some((item) => item.status === "armed")) return null;

    const processStatus = new Map<string, string>();
    const processLogs = new Map<string, string>();
    for (const item of items) {
      if (!item.processId || processStatus.has(item.processId)) continue;
      const proc = await this.processes.get(item.processId);
      processStatus.set(item.processId, proc?.status ?? "missing");
      processLogs.set(item.processId, await this.processes.logs(item.processId));
    }

    const due = dueWakes(items, Date.now(), processStatus, processLogs);
    if (!due.length) return null;

    let resumed: string | null = null;
    for (const wake of due) {
      const run = await this.runs.get(wake.runId);
      if (!run || run.status === "done" || run.status === "parked" || run.status === "failed") {
        items = cancelWakesForRun(items, wake.runId);
        continue;
      }
      const extra = wake.processId
        ? `Process status: ${processStatus.get(wake.processId) ?? "unknown"}`
        : "";
      run.append("system", `Wake fired: ${wake.id} (${wake.kind}) — ${wake.reason}${extra ? `\n${extra}` : ""}`);
      await this.runs.save(run);
      items = markWakeFired(items, wake.id);
      this.events.publish([event("wake.fired", { wakeId: wake.id, runId: wake.runId, kind: wake.kind })]);

      if (!resumed && !this.sessionService.isBusy() && !this.sessionService.isRunning(wake.runId)) {
        try {
          await this.sessionService.prompt(wake.runId, wakePrompt(wake, extra));
          resumed = wake.id;
        } catch (err) {
          console.error("wake resume", err);
        }
      }
    }

    await this.memories.save(new MemoryNote({
      key,
      title: "Wakes",
      body: formatWakes(items.slice(-80)),
      tags: ["wake", "autonomy"],
      sourceAgentId: agent.id.value,
    }));
    return resumed;
  }

  private async refreshAgenda(
    agentId: string,
    fails: Array<{ failureMode?: string | null; nextHint?: string | null; outcome: string }>,
    recent: MemoryNote[],
  ): Promise<AgendaItem[]> {
    const key = agendaMemoryKey(agentId);
    const existing = parseAgenda((await this.memories.get(key))?.body ?? "");
    const backlogGaps = gapsFromBacklogRows(
      recent
        .filter((note) => note.tags.includes("backlog"))
        .map((note) => {
          const row = parseBacklog(note.body);
          return row ? { klass: row.klass, count: row.count, hint: note.title } : null;
        })
        .filter((row): row is { klass: string; count: number; hint: string } => Boolean(row)),
    );
    const episodeGaps = gapsFromFailEpisodes(fails);
    const proposed = [...backlogGaps, ...episodeGaps].map((gap) => proposeAgendaItem(gap));
    const merged = mergeAgenda(existing, proposed);
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      await this.memories.save(new MemoryNote({
        key,
        title: "Autonomy agenda",
        body: formatAgenda(merged),
        tags: ["agenda", "autonomy"],
        sourceAgentId: agentId,
      }));
    }
    return merged;
  }

  private async runPlasticSleep(
    agentId: string,
    skillRecs: ReturnType<typeof parseSkillBody>[],
    recent: MemoryNote[],
  ): Promise<void> {
    this.lastPlasticSleepAt = Date.now();
    const { next, actions } = planPlasticSleep(skillRecs);
    for (const rec of next) {
      const prev = skillRecs.find((item) => item.name === rec.name);
      if (!prev || JSON.stringify(prev) === JSON.stringify(rec)) continue;
      await this.memories.save(new MemoryNote({
        key: skillBodyKey(rec.name),
        title: `Body: ${rec.name}`,
        body: JSON.stringify(rec),
        tags: ["body", "skill", rec.status, "plasticity", "sleep"],
        sourceAgentId: agentId,
      }));
    }
    const synNotes = recent.filter((note) => note.tags.includes("synapse"));
    const synapses = synNotes.map((note) => {
      const ref = note.key.replace(/^plasticity\/rule\//, "") || note.title;
      return parseSynapse(note.body, "rule", ref);
    });
    const slept = planSynapseSleep(synapses);
    for (const syn of slept) {
      await this.memories.save(new MemoryNote({
        key: synapseKey(syn.kind, syn.ref),
        title: `Synapse ${syn.kind} ${syn.ref}`,
        body: formatSynapse(syn),
        tags: ["plasticity", "synapse", syn.kind, syn.status, "sleep"],
        sourceAgentId: agentId,
      }));
    }
    const meaningful = actions.filter((action) => action.op !== "keep");
    await this.memories.save(new MemoryNote({
      key: slugKey(`plasticity/sleep/${new Date().toISOString().slice(0, 13)}`),
      title: "Plastic sleep",
      body: meaningful.length
        ? meaningful.map((action) => JSON.stringify(action)).join("\n")
        : "no structural changes",
      tags: ["plasticity", "sleep"],
      sourceAgentId: agentId,
    }));
  }

  private async runAutonomyDrill(
    agentId: string,
    agendaId: string,
    goal: string,
    failClass: string,
  ): Promise<void> {
    this.lastSelfRunAt = Date.now();
    const key = agendaMemoryKey(agentId);
    let items = parseAgenda((await this.memories.get(key))?.body ?? "");
    items = markAgenda(items, agendaId, { status: "running" });
    await this.memories.save(new MemoryNote({
      key,
      title: "Autonomy agenda",
      body: formatAgenda(items),
      tags: ["agenda", "autonomy"],
      sourceAgentId: agentId,
    }));
    try {
      const created = await this.createRun(goal, agentId);
      items = markAgenda(items, agendaId, { status: "running", runId: created.id.value });
      await this.memories.save(new MemoryNote({
        key,
        title: "Autonomy agenda",
        body: formatAgenda(items),
        tags: ["agenda", "autonomy"],
        sourceAgentId: agentId,
      }));
      const done = await this.send(created.id.value, goal);
      const ok = done.status === "done";
      items = markAgenda(items, agendaId, {
        status: ok ? "done" : "dropped",
        runId: created.id.value,
        finishedAt: new Date().toISOString(),
      });
      await this.memories.save(new MemoryNote({
        key,
        title: "Autonomy agenda",
        body: formatAgenda(items),
        tags: ["agenda", "autonomy", failClass, ok ? "done" : "dropped"],
        sourceAgentId: agentId,
        sourceRunId: created.id.value,
      }));
    } catch {
      items = markAgenda(items, agendaId, {
        status: "dropped",
        finishedAt: new Date().toISOString(),
      });
      await this.memories.save(new MemoryNote({
        key,
        title: "Autonomy agenda",
        body: formatAgenda(items),
        tags: ["agenda", "autonomy", "dropped"],
        sourceAgentId: agentId,
      }));
    }
  }

  private async dreamCompress(shadow: string[], rules: string[]): Promise<string[]> {
    const mergedRules = mergeFailureRules(rules);
    try {
      const result = await this.llm.complete("planner", [
        { role: "system", content: dreamSystemPrompt() },
        { role: "user", content: dreamUserPrompt(shadow, mergedRules) },
      ]);
      const parsed = parseDreamHeuristics(result.text || result.thinking || "");
      if (parsed.length) return mergeFailureRules([...parsed, ...mergedRules]);
    } catch {
      /* local fallback */
    }
    return mergeFailureRules([...compressShadowLocally(shadow), ...mergedRules]);
  }

  private async postDesignSession(agentId: string): Promise<void> {
    const runs = await this.runs.list();
    const open = runs.find((run) => isDesignGoal(run.goal) && run.status !== "done" && run.status !== "failed");
    if (open) {
      const knowsName = open.transcript.some((item) => item.text.includes("The name Barney is a dedication"));
      if (!knowsName) {
        open.append("assistant", DESIGN_PROMPT);
        await this.runs.save(open);
        this.events.publish([event("run.design", { runId: open.id.value, posted: DESIGN_MARKER })]);
      }
      return;
    }
    if (runs.some((run) => isDesignGoal(run.goal))) return;
    const run = await this.startRun.execute({ goal: DESIGN_GOAL, agentId });
    run.append("assistant", DESIGN_PROMPT);
    await this.runs.save(run);
    this.events.publish([event("run.design", { runId: run.id.value, posted: DESIGN_MARKER })]);
  }

  private async become(agentId: string, message: string): Promise<void> {
    try {
      const note = await this.memories.get(samostKey(agentId));
      if (note) await this.homeRepo.exportSamost(note.body);
      await this.homeRepo.commit(message);
    } catch {
      // home git is biography; boot/tick must still work if git is unavailable
    }
  }

  mask(text: string, path?: string): string {
    return this.scanner.scan(text, path).text;
  }

  reveal(text: string): string {
    return this.vault.reveal(text);
  }

  /** Allow fs_* under a path prefix outside the worktree for this session. */
  async grantOutside(runId: string, path: string): Promise<string> {
    const abs = resolve(String(path || "").trim() || ".");
    const prefix = permissionPrefix(abs) || abs;
    if (!prefix) throw new Error("path required");
    const grants = this.outsideGrants.get(runId) ?? new Set<string>();
    grants.add(prefix);
    this.outsideGrants.set(runId, grants);
    this.events.publish([event("run.permission_granted", { runId, prefix, mode: "user" })]);
    const run = await this.runs.get(runId);
    if (run) {
      run.append("system", permissionGrantedMessage(prefix, "user"));
      await this.runs.save(run);
    }
    return prefix;
  }

  listOutsideGrants(runId: string): string[] {
    return [...(this.outsideGrants.get(runId) ?? [])].sort();
  }

  outsideAllowed(runId: string | undefined, absPath: string): boolean {
    if (autoApproveOutside()) return true;
    if (!runId) return false;
    return pathAllowedByGrants(absPath, this.outsideGrants.get(runId) ?? []);
  }

  workspaceFor(root: string, runId?: string): NodeWorkspace {
    return new NodeWorkspace(
      root,
      (text, path) => this.mask(text, path),
      (text) => this.reveal(text),
      { isAllowed: (abs) => this.outsideAllowed(runId, abs) },
    );
  }

  async createRun(goal: string, agentId?: string, repoDir?: string): Promise<Run> {
    return this.sessionService.create(goal, agentId, repoDir);
  }

  async send(runId: string, message: string): Promise<Run> {
    return this.sessionService.prompt(runId, message);
  }

  stepRunning(runId: string): boolean {
    return this.sessionService.isRunning(runId);
  }

  async resume(runId: string, mode: "continue" | "retry" = "continue"): Promise<Run> {
    return this.sessionService.resume(runId, mode);
  }

  abortStep(runId: string): { ok: boolean } {
    return this.sessionService.cancel(runId);
  }

  async formFromRun(runId: string, name?: string) {
    const result = await this.formAgent.execute({ runId, name });
    await this.memories.save(new MemoryNote({
      key: `agent/${result.agent.name}`,
      title: `Formation ${result.decision}: ${result.agent.name}`,
      body: result.agent.constitution.slice(0, 1200),
      tags: ["agent", result.decision],
      sourceRunId: runId,
      sourceAgentId: result.agent.id.value,
    }));
    return result;
  }

  async closeSession(runId: string): Promise<Run> {
    return this.sessionService.close(runId);
  }

  async listAgents(): Promise<Agent[]> {
    await this.boot();
    return this.agents.list();
  }

  async listRuns(): Promise<Run[]> {
    return this.runs.list();
  }

  async getRun(id: string): Promise<Run | null> {
    return this.runs.get(id);
  }

  async listMemory(query?: string, limit = 60) {
    await this.boot();
    const notes = query?.trim()
      ? await this.memories.search(query.trim(), limit)
      : await this.memories.recent(limit);
    return notes.map((note) => ({ ...note.view(), shelf: memoryShelf(note) }));
  }

  async experienceGraph(limit = 80) {
    await this.boot();
    return this.experience.snapshot(limit);
  }

  async getMemory(idOrKey: string) {
    await this.boot();
    const note = await this.memories.get(idOrKey);
    return note ? { ...note.view(), shelf: memoryShelf(note) } : null;
  }

  async writeMemory(input: { key?: string; title: string; body: string; tags?: string[]; sourceRunId?: string }) {
    await this.boot();
    const agent = await this.ensureAgent.execute();
    const key = input.key?.trim();
    if (key) {
      const existing = await this.memories.get(key);
      if (existing && memoryShelf(existing) !== "yours") {
        throw new Error("Lessons grow from work and cannot be edited by hand");
      }
    }
    const title = this.mask(input.title);
    const body = this.mask(input.body);
    const saved = await this.memories.save(new MemoryNote({
      key: key || slugKey(title),
      title,
      body,
      tags: ["operator"],
      sourceRunId: input.sourceRunId ?? "",
      sourceAgentId: agent.id.value,
    }));
    return { ...saved.view(), shelf: memoryShelf(saved) };
  }

  async removeMemory(idOrKey: string) {
    await this.boot();
    const note = await this.memories.get(idOrKey);
    if (!note) return false;
    if (memoryShelf(note) !== "yours") {
      throw new Error("Only your notes can be deleted here");
    }
    return this.memories.remove(note.id);
  }

  async psycheState(runId?: string) {
    const agent = await this.boot();
    const samostNote = await this.memories.get(samostKey(agent.id.value));
    const design = await this.memories.get(designKey(agent.id.value));
    const run = runId ? await this.runs.get(runId) : null;
    const existence = run
      ? parseExistence((await this.memories.get(existenceKey(run.id.value)))?.body ?? "")
      : [];
    const board = run
      ? parseBoard((await this.memories.get(boardKey(run.id.value)))?.body ?? "")
      : [];
    const episodes = await this.episodes.findRecent(8);
    return {
      agent: {
        id: agent.id.value,
        name: agent.name,
        version: agent.version,
        constitution: agent.constitution,
        taskClass: agent.taskClass,
      },
      samost: parseSamost(samostNote?.body ?? ""),
      designSealed: isDesignSealed(design?.body),
      existence,
      board,
      episodes: episodes.map((item) => ({
        id: item.id,
        runId: item.runId,
        goal: item.goal,
        outcome: item.outcome,
        failureMode: item.failureMode,
        nextHint: item.nextHint,
        createdAt: item.createdAt,
      })),
    };
  }

  async updatePsyche(input: {
    compass?: string;
    character?: string[];
    light?: string[];
    shadow?: string[];
    constitution?: string;
  }) {
    const agent = await this.boot();
    if (input.constitution !== undefined) {
      const next = this.mask(input.constitution).trim();
      if (!next) throw new Error("constitution is required");
      if (isPersonaConstitution(next)) throw new Error("constitution cannot start with You are");
      agent.constitution = next;
      await this.agents.save(agent);
    }
    const current = parseSamost((await this.memories.get(samostKey(agent.id.value)))?.body ?? "");
    const samost = {
      compass: input.compass !== undefined ? this.mask(input.compass).trim() || current.compass : current.compass,
      character: input.character ? input.character.map((line) => this.mask(line).trim()).filter(Boolean) : current.character,
      light: input.light ? input.light.map((line) => this.mask(line).trim()).filter(Boolean) : current.light,
      shadow: input.shadow ? input.shadow.map((line) => this.mask(line).trim()).filter(Boolean) : current.shadow,
    };
    await this.memories.save(new MemoryNote({
      key: samostKey(agent.id.value),
      title: "Self",
      body: formatSamost(samost),
      tags: ["samost", "psyche"],
      sourceAgentId: agent.id.value,
    }));
    try {
      await this.homeRepo.exportSamost(formatSamost(samost));
      await this.homeRepo.commit("become: samost");
    } catch {
      // home git is biography; a failed commit must not block the operator
    }
    return this.psycheState();
  }

  listFiles(worktreePath: string, rel = ""): Array<{ name: string; path: string; dir: boolean }> {
    try {
      const ws = new NodeWorkspace(worktreePath, (text, path) => this.mask(text, path));
      const abs = ws.resolveSafe(rel || ".");
      return readdirSync(abs)
        .filter((name) => name !== ".git" && name !== "node_modules")
        .map((name) => {
          const path = rel ? join(rel, name) : name;
          const dir = statSync(join(abs, name)).isDirectory();
          return { name, path, dir };
        });
    } catch {
      return [];
    }
  }

  readFile(worktreePath: string, rel: string): string {
    const ws = new NodeWorkspace(worktreePath, (text, path) => this.mask(text, path));
    const full = ws.resolveSafe(rel);
    const raw = readFileSync(full, "utf8");
    return this.mask(raw, full);
  }

  readFileBytes(worktreePath: string, rel: string): { bytes: Uint8Array; type: string } {
    const ws = new NodeWorkspace(worktreePath, (text, path) => this.mask(text, path));
    const full = ws.resolveSafe(rel);
    const bytes = new Uint8Array(readFileSync(full));
    const lower = rel.toLowerCase();
    const type = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "application/octet-stream";
    return { bytes, type };
  }

  async providerState() {
    await this.boot();
    const [items, bindings] = await Promise.all([this.providers.list(), this.providers.bindings()]);
    return { providers: items.map((p) => p.view()), bindings, lanes: lanesFromBindings(bindings) };
  }

  async addOpenAiProvider(input: { name: string; host: string; apiKey?: string; dialect?: string }) {
    await this.boot();
    const name = input.name.trim();
    const existing = await this.providers.findByName(name);
    if (existing) {
      if (existing.kind === "stub") throw new Error("cannot overwrite stub — pick another name");
      return this.updateProvider(existing.id, {
        host: input.host,
        apiKey: input.apiKey,
        dialect: input.dialect,
      });
    }
    const provider = LlmProvider.create({
      name,
      kind: "openai-compat",
      host: input.host,
      apiKey: input.apiKey,
      dialect: input.dialect,
    });
    await this.providers.save(provider);
    return provider.view();
  }

  async resolveProvider(idOrName: string): Promise<LlmProvider> {
    await this.boot();
    const found = (await this.providers.get(idOrName)) ?? (await this.providers.findByName(idOrName));
    if (!found) throw new Error(`provider not found: ${idOrName}`);
    return found;
  }

  async refreshModels(idOrName: string): Promise<string[]> {
    const provider = await this.resolveProvider(idOrName);
    const models = await listRemoteModels(provider);
    if (models[0] && !provider.defaultModel) {
      provider.defaultModel = models[0];
      await this.providers.save(provider);
    }
    return models;
  }

  async useProvider(idOrName: string, model?: string) {
    const provider = await this.resolveProvider(idOrName);
    const chosen = model || provider.defaultModel || (await listRemoteModels(provider))[0];
    if (!chosen) throw new Error("no model — pass --model or refresh /v1/models");
    await this.providers.setDefault(provider.id, chosen);
    await seedUnifiedRoleBindings(this.providers);
    return { provider: provider.view(), model: chosen };
  }

  async useLanes(input: {
    large: { providerId: string; model?: string };
    small?: { providerId: string; model?: string };
  }) {
    await this.boot();
    const largeProv = await this.resolveProvider(input.large.providerId);
    const largeModel = input.large.model?.trim() || largeProv.defaultModel || (await listRemoteModels(largeProv))[0];
    if (!largeModel) throw new Error("no model — pick one or refresh /v1/models");
    void input.small;
    for (const role of ROLES) await this.providers.setBinding(role, largeProv.id, largeModel);
    largeProv.defaultModel = largeModel;
    await this.providers.save(largeProv);
    return this.providerState();
  }

  async updateProvider(idOrName: string, patch: { name?: string; host?: string; apiKey?: string | null; dialect?: string }) {
    const current = await this.resolveProvider(idOrName);
    const next = LlmProvider.create({
      id: current.id,
      name: patch.name ?? current.name,
      kind: current.kind,
      host: patch.host ?? current.baseUrl,
      apiKey: patch.apiKey === undefined ? current.apiKey : patch.apiKey,
      defaultModel: current.defaultModel,
      dialect: patch.dialect ?? (patch.host || patch.name ? undefined : current.dialect),
    });
    await this.providers.save(next);
    return next.view();
  }

  async removeProvider(idOrName: string) {
    const provider = await this.resolveProvider(idOrName);
    if (provider.name === "stub") throw new Error("cannot remove stub");
    await this.providers.remove(provider.id);
  }

  private async listTeam(): Promise<TeamAgentView[]> {
    const agents = await this.agents.list();
    return agents.map((agent) => ({
      id: agent.id.value,
      name: agent.name,
      version: agent.version,
      taskClass: agent.taskClass,
      skills: agent.skillsLock.list().map((skill) => `${skill.kind}:${skill.name}`),
    }));
  }

  private async spawnSpecialist(input: { name: string; task: string; skills?: string[] }): Promise<TeamAgentView> {
    const name = slugName(input.name);
    const skills = (input.skills ?? []).map((skill) => ({ kind: "skill" as const, name: skill, version: "1" }));
    const existing = await this.agents.findByName(name);
    if (existing) {
      existing.evolve({ constitutionNote: input.task, skills });
      await this.agents.save(existing);
      this.events.publish([event("agent.evolved", { agentId: existing.id.value, task: input.task })]);
      return teamView(existing);
    }
    const agent = Agent.create({
      name,
      taskClass: slugName(input.task).slice(0, 32) || "specialist",
      constitution: `Specialist ${name}, not a character.\n${input.task}\nWrite notes with memory_write. Reuse plugins. Do not spawn further agents.`,
      skills,
    });
    await this.agents.save(agent);
    this.events.publish([event("agent.formed", { agentId: agent.id.value, name, task: input.task })]);
    return teamView(agent);
  }

  private async delegateTask(input: { parentRunId: string; agent: string; task: string; signal?: AbortSignal }): Promise<string> {
    const parent = await this.runs.get(input.parentRunId);
    if (!parent) return "error: parent session missing";
    const agents = await this.agents.list();
    const agent = agents.find((item) => item.id.value === input.agent || item.name === input.agent || item.name === slugName(input.agent));
    if (!agent) return `error: agent not found: ${input.agent}. agent_list or agent_spawn first.`;
    const child = await this.startRun.execute({
      goal: input.task,
      agentId: agent.id.value,
      worktreePath: parent.worktreePath,
    });
    child.append("system", `Delegated from ${parent.id.value} by ${parent.agentId}. Share the worktree. Write findings to memory_write.`);
    await this.runs.save(child);
    this.events.publish([event("agent.delegated", { parentRunId: parent.id.value, childRunId: child.id.value, agent: agent.name })]);
    const finished = await this.driveSolve.execute({
      runId: child.id.value,
      message: input.task,
      signal: input.signal,
      depth: 1,
    });
    const answer = lastAssistant(finished) || "(no reply)";
    const note = await this.memories.save(new MemoryNote({
      key: `delegate/${child.id.value}`,
      title: `${agent.name}: ${input.task.slice(0, 80)}`,
      body: answer.slice(0, 4000),
      tags: ["delegate", agent.name],
      sourceRunId: child.id.value,
      sourceAgentId: agent.id.value,
    }));
    return `delegate ${agent.name} status=${finished.status}\nmemory: ${note.key}\n${answer.slice(0, 1200)}`;
  }
}

function teamView(agent: Agent): TeamAgentView {
  return {
    id: agent.id.value,
    name: agent.name,
    version: agent.version,
    taskClass: agent.taskClass,
    skills: agent.skillsLock.list().map((skill) => `${skill.kind}:${skill.name}`),
  };
}

function lastAssistant(run: Run): string {
  return [...run.transcript].reverse().find((item) => item.kind === "assistant")?.text ?? "";
}

function slugName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "specialist";
}

let singleton: Kernel | undefined;

export function getKernel(): Kernel {
  singleton ??= new Kernel();
  return singleton;
}
