import { cycleStrategy, stopAfterFail, wantingWithoutLiking } from "../context/controlLoop.ts";
import { draftPlan, formatPlan } from "../context/draftPlan.ts";
import { bindToolArgs, goalAnchors } from "../context/bindAnchor.ts";
import { bumpBacklog, failureClass, formatBacklog, parseBacklog, shouldCloseClass, skillDraft } from "../context/failureClass.ts";
import { lessonRule, pickRules, isRecapLesson } from "../context/lessonRule.ts";
import { sealReply } from "../context/sealReply.ts";
import { judgeReview } from "../context/reviewJudge.ts";
import { applyToolObserve } from "../context/observeTool.ts";
import { clipText, packSession, redactSecrets } from "../context/packSession.ts";
import { visibleAssistantText } from "../../infrastructure/llm/visibleReply.ts";
import { formatResearchBrief, runDeepResearch } from "../research/DeepResearch.ts";
import { parseTurnRoute, ROUTE_RULES, shouldEscalateFromShort, type TurnRoute } from "../context/turnMode.ts";
import { clipPage } from "../research/clipPage.ts";
import { pageEvidence, parseReplyCheck, replyOmitsPageCode, VERIFY_SYSTEM, verifyPacket } from "../research/verifyReply.ts";
import { addBoard, formatBoard, parseBoard, renderBoardPrompt, type BoardEntry } from "../psyche/board.ts";
import { appendExistence, formatExistence, parseExistence, renderExistencePrompt, type ExistenceBlock } from "../psyche/existence.ts";
import {
  confirmDesign,
  constitutionFromDesign,
  formatDesignNote,
  isDesignGoal,
  parseDesignAnswers,
  samostFromDesign,
} from "../psyche/design.ts";
import { boardKey, designKey, existenceKey, samostKey } from "../psyche/keys.ts";
import { absorbIntoSamost, formatSamost, parseSamost, renderSamostPrompt, seedSamost, type Samost } from "../psyche/samost.ts";
import { renderSkillCatalog } from "../skills/starterSkills.ts";
import { Episode } from "../../domain/memory/Episode.ts";
import { MemoryNote, slugKey } from "../../domain/memory/MemoryNote.ts";
import type { ChatMessage, ChatResult, Role } from "../../domain/provider/Role.ts";
import type { ToolSpec } from "../../domain/tools/FileTools.ts";
import type { Agent } from "../../domain/agent/Agent.ts";
import type { Review } from "../../domain/run/Review.ts";
import type { Run } from "../../domain/run/Run.ts";
import { replyMetaFrom } from "../../domain/run/replyMeta.ts";
import type { StrategyName } from "../../domain/run/Strategy.ts";
import { event } from "../../domain/shared/DomainEvent.ts";
import { DomainError } from "../../domain/shared/DomainError.ts";
import { AGENT_TOOLS, CHILD_TOOLS, FILE_TOOLS, type ToolCall } from "../../domain/tools/FileTools.ts";
import type {
  AgentRepository,
  BrowserPort,
  EpisodeRepository,
  EventBus,
  LlmPort,
  McpPort,
  McpRuntimePort,
  MemoryRepository,
  ProcessPort,
  ResearchPort,
  RunRepository,
  SkillPort,
  HomeRepoPort,
  TeamPort,
  WorkspacePort,
} from "../ports.ts";
import { runBrowserTool } from "../tools/runBrowserTool.ts";
import { runFileTool } from "../tools/runFileTool.ts";
import { runMcpTool } from "../tools/runMcpTool.ts";
import { runMemoryTool } from "../tools/runMemoryTool.ts";
import { runProcessTool } from "../tools/runProcessTool.ts";
import { runSelfTool } from "../tools/runSelfTool.ts";
import { runSkillTool } from "../tools/runSkillTool.ts";
import { runTeamTool } from "../tools/runTeamTool.ts";

const MAX_TOOL_ROUNDS = 12;
const WRITE_TOOLS = FILE_TOOLS.filter((tool) => tool.name === "fs_write" || tool.name === "fs_list");

type PsycheState = {
  samost: Samost;
  existence: ExistenceBlock[];
  board: BoardEntry[];
};

export class DriveSolve {
  constructor(
    private readonly agents: AgentRepository,
    private readonly runs: RunRepository,
    private readonly episodes: EpisodeRepository,
    private readonly llm: LlmPort,
    private readonly research: ResearchPort,
    private readonly events: EventBus,
    private readonly workspaceFor: (root: string) => WorkspacePort,
    private readonly skills: SkillPort,
    private readonly browser: BrowserPort,
    private readonly memory: MemoryRepository,
    private readonly mcp: McpPort,
    private readonly team: TeamPort,
    private readonly home: HomeRepoPort,
    private readonly processes: ProcessPort,
    private readonly mcpRuntime: McpRuntimePort,
  ) {}

  async execute(input: { runId: string; message: string; signal?: AbortSignal; depth?: number; forceFull?: boolean }): Promise<Run> {
    const run = await this.runs.get(input.runId);
    if (!run) throw new Error(`run not found: ${input.runId}`);
    const agent = await this.agents.get(run.agentId);
    if (!agent) throw new Error("agent missing for run");
    const depth = input.depth ?? 0;

    const throwIfAborted = () => {
      if (input.signal?.aborted) throw new DomainError("aborted", "step interrupted");
    };

    run.append("user", input.message);
    if (isDesignGoal(run.goal) && depth === 0) {
      return this.sealDesign(run, agent, input.message);
    }
    let routed: TurnRoute | undefined;
    if (depth === 0 && !input.forceFull) {
      routed = await this.routeTurn(run, throwIfAborted, input.signal);
      if (!routed.needLarge) {
        const short = await this.executeShort(run, agent, input.message, throwIfAborted, input.signal);
        if (short !== "full") return short;
      }
    }
    const packed = packSession(run.transcript, run.goal);
    await this.remember(run, agent.id.value, {
      key: `session/${run.id.value}/digest`,
      title: `Session: ${run.goal.slice(0, 80)}`,
      body: redactSecrets(packed.digest),
      tags: ["session", "digest", run.taskClass],
    });
    const past = await this.episodes.findForAgent(agent.id.value, run.taskClass);
    const digestKey = slugKey(`session/${run.id.value}/digest`);
    const shared = (await this.memory.search(input.message, 3)).filter((note) =>
      note.key !== digestKey
      && !note.key.startsWith("plan/")
      && !note.key.startsWith("session/")
      && !isPsycheKey(note.key)
      && !note.tags.includes("rule")
      && !note.tags.includes("samost")
      && !note.tags.includes("digest"),
    );
    const recentMemories = await this.memory.recent(40);
    const rules = pickRules(recentMemories, run.taskClass);
    const psyche = await this.loadPsyche(run, agent.id.value);
    psyche.existence = appendExistence(psyche.existence, { kind: "act", text: clipText(input.message, 180) });
    psyche.board = addBoard(psyche.board, { kind: "motive", text: clipText(run.goal, 200) });
    psyche.board = addBoard(psyche.board, { kind: "action", text: clipText(input.message, 180) });
    for (const anchor of packed.anchors) {
      psyche.board = addBoard(psyche.board, { kind: "fact", text: anchor });
    }
    await this.flushPsyche(run, agent.id.value, psyche);
    const planKey = `plan/${run.id.value}`;
    const existingPlan = await this.memory.get(planKey);
    const failMarkers = past
      .filter((episode) => episode.outcome === "fail")
      .slice(0, 4)
      .map((episode) => episode.nextHint || episode.failureMode || "")
      .filter(Boolean);
    const planText = existingPlan?.body.trim() || formatPlan(draftPlan({
      goal: run.goal,
      latest: input.message,
      anchors: packed.anchors,
      markers: failMarkers,
    }));
    if (!existingPlan) {
      await this.remember(run, agent.id.value, {
        key: planKey,
        title: `Plan for session ${run.id.value}`,
        body: planText,
        tags: ["plan", run.taskClass],
      });
    }
    const memoryNote = [
      rules.length ? `Rules from past runs of this task class (obey these):\n${rules.map((line) => `- ${line}`).join("\n")}` : "",
      packed.digest ? `Session so far (compressed; full chat stays in the portal):\n${packed.digest}` : "",
      ...shared.map((note) => `[${note.key}] ${note.title}: ${note.body.slice(0, 160)}`),
      ...past.slice(0, 3).map((e) => `[${e.outcome}] ${e.goal} → ${e.nextHint}`),
    ].filter(Boolean).join("\n\n");
    const failedCalls = new Set<string>();
    const familyFails = new Map<string, number>();

    try {
      this.events.publish(run.beginAct("retry_with_error", `${input.message.slice(0, 80)} #${run.attempts + 1}`));
    } catch (err) {
      if (err instanceof DomainError && err.code === "review_required") {
        /* continue into review path below */
      } else if (err instanceof DomainError && (err.code === "repeat_plan" || err.code === "run_closed")) {
        run.append("system", err.message);
        await this.runs.save(run);
        return run;
      } else {
        throw err;
      }
    }

    const actMessages: ChatMessage[] = [
      {
        role: "system",
        content: [
          agent.constitution,
          PSYCHE_RULES,
          renderSamostPrompt(psyche.samost, `${run.goal}\n${input.message}`),
          renderExistencePrompt(psyche.existence),
          renderBoardPrompt(psyche.board),
          AUTONOMY_RULES,
          `Session goal (copy URLs/IPs exactly): ${run.goal}`,
          packed.anchors.length
            ? `Session facts (copy exactly, never truncate or guess):\n${packed.anchors.map((a) => `- ${a}`).join("\n")}`
            : "",
          `Working plan (execute in order; do not skip to guessing):\n${planText}`,
          `Worktree: ${run.worktreePath}`,
          depth > 0 ? "Delegated specialist, not a character. Do the subtask. Write notes with memory_write. Do not spawn agents." : "",
          "Prefer fs_* tools for files (paths relative to the worktree). Change an existing file with fs_edit or fs_append — do not fs_write over it unless the user asked to replace the whole file.",
          "Use shell for OS commands such as date, git, short builds. cwd is the worktree. On Windows the shell is cmd.exe; elsewhere /bin/sh. Shell waits up to 120s. For longer jobs: process_spawn, then process_logs. Shell blocks sudo, wipes outside the worktree, and piping a download into a shell.",
          depth > 0
            ? "Tools: fs_*, shell, process_*, web_search, plugin_*, browser_*, memory_*, board_read/write, mcp_list/start/call/stop/write, agent_list, self_status/log/commit."
            : "Tools: fs_*, shell, process_spawn/list/logs/kill, web_search, plugin_list/read/write/open, browser_*, memory_search/write/read, board_read/write, plan_set, agent_list/spawn/delegate, mcp_list/write/start/call/stop, self_status/log/commit/rollback.",
          BROWSER_RULES,
          skillCatalog(this.skills, `${run.goal}\n${input.message}`),
          PLUGIN_RULES,
          MEMORY_RULES,
          depth > 0 ? "" : TEAM_RULES,
          MCP_RULES,
          "Do not answer from memory when a fact can be checked. Tools first, then the reply. After tools, every concrete fact in the reply must appear in the tool output — if it does not, fix the reply before the user sees it. For the world, APIs, people, products, or current facts: web_search, then browser_open at least two sources. Snippets are not enough. Thinking stays short. After tools, summarize — do not dump raw HTML.",
          "Format the visible reply in Markdown: headings, lists, tables, fenced code.",
          "For flowcharts and diagrams use a mermaid fence. Quote labels that contain parentheses, slashes, or line breaks. Use <br> not <br/>:\n```mermaid\nflowchart TD\n  A[Ask] --> B[\"PostgreSQL<br>(Primary)\"]\n```",
          "For a titled visual card (spec sheet, comparison, small dashboard) use:\n```canvas\n# Title\n...markdown or mermaid...\n```",
          "The portal renders Markdown, mermaid (flowchart/sequence/etc), and canvas cards. Use them when they help.",
          `Shared memory and past episodes:\n${memoryNote || "(empty — search or write with memory_search / memory_write)"}`,
        ].filter(Boolean).join("\n\n"),
      },
      ...packed.recent,
    ];

    try {
    throwIfAborted();
    if (routed?.needResearch) {
      const brief = await this.collectResearch(run, input.message, input.signal);
      run.append("research", brief);
      await this.runs.save(run);
      actMessages[0] = {
        role: "system",
        content: `${actMessages[0]?.content ?? ""}\n\nDeep research brief (verify before answering; copy URLs exactly):\n${brief}`,
      };
    }
    throwIfAborted();
    let act = await this.actWithTools(run, actMessages, input.signal, depth, failedCalls, psyche, familyFails);
    throwIfAborted();
    act = this.sealAct(run, await this.verifyAgainstEvidence(run, act, input.signal), input.message);
    throwIfAborted();
    this.commitAct(run, act);

    const reviewPrompt: ChatMessage[] = [
      { role: "system", content: REVIEWER_SYSTEM },
      { role: "user", content: reviewPacket(run.goal, input.message, act.text, recentEvidence(run)) },
    ];
    throwIfAborted();
    const reviewRaw = await this.completeRole(run, "reviewer", reviewPrompt, { signal: input.signal });
    let review = judgeReview(reviewRaw.text, input.message, recentEvidence(run), act.text);
    const reviewEvents = run.submitReview(review);
    this.events.publish(reviewEvents);

    if (run.status === "researching") {
      const query = review.knowledgeQuery || review.summary;
      throwIfAborted();
      const note = await this.collectResearch(run, query, input.signal);
      this.events.publish(run.finishResearch(note));
      if (!run.budget.exhausted()) {
        try {
          this.events.publish(run.continueWith("research", `apply research: ${query}`));
          throwIfAborted();
          const second = this.sealAct(run, await this.verifyAgainstEvidence(run, await this.actWithTools(run, [
            ...actMessages,
            { role: "assistant", content: act.text },
            { role: "user", content: `Research notes:\n${note}\nContinue solving. Do not repeat the previous plan.` },
          ], input.signal, depth, failedCalls, psyche, familyFails), input.signal), input.message);
          this.commitAct(run, second);
          throwIfAborted();
          const review2Raw = await this.completeRole(run, "reviewer", [
            { role: "system", content: reviewPrompt[0].content },
            { role: "user", content: reviewPacket(run.goal, input.message, second.text, recentEvidence(run)) },
          ], { signal: input.signal });
          const review2 = judgeReview(review2Raw.text, input.message, recentEvidence(run), second.text);
          this.events.publish(run.submitReview(review2));
          act = second;
          review = review2;
        } catch (err) {
          if (isAbort(err)) throw err;
          if (err instanceof DomainError) run.append("system", err.message);
          else throw err;
        }
      }
    }

    if (run.status === "ready" && review.verdict !== "pass" && !run.transcript.some((item) => item.kind === "console")) {
      try {
        this.events.publish(run.continueWith("retry_with_error", "no tools ran; execute the request"));
        throwIfAborted();
        const retry = this.sealAct(run, await this.verifyAgainstEvidence(run, await this.actWithTools(run, [
          ...actMessages,
          { role: "assistant", content: act.text },
          { role: "user", content: RECOVERY_NUDGE },
        ], input.signal, depth, failedCalls, psyche, familyFails), input.signal), input.message);
        this.commitAct(run, retry);
        throwIfAborted();
        const retryReviewRaw = await this.completeRole(run, "reviewer", [
          { role: "system", content: reviewPrompt[0].content },
          { role: "user", content: reviewPacket(run.goal, input.message, retry.text, recentEvidence(run)) },
        ], { signal: input.signal });
        const retryReview = judgeReview(retryReviewRaw.text, input.message, recentEvidence(run), retry.text);
        this.events.publish(run.submitReview(retryReview));
        act = retry;
        review = retryReview;
      } catch (err) {
        if (isAbort(err)) throw err;
        if (err instanceof DomainError) run.append("system", err.message);
        else throw err;
      }
    }

    if (run.status === "ready" && review.verdict !== "pass") {
      const persisted = await this.persistUntilDone({
        run,
        actMessages,
        act,
        review,
        latest: input.message,
        depth,
        signal: input.signal,
        failedCalls,
        familyFails,
        psyche,
      });
      act = persisted.act;
      review = persisted.review;
    }

    if (run.status === "ready" && review.verdict !== "pass") {
      const missing = review.missing || review.summary || "the requested result";
      const why = stopAfterFail(review, {
        exhausted: run.budget.exhausted(),
        attempts: run.attempts,
        maxAttempts: run.maxAttempts,
        minStrategies: run.minStrategies,
        used: run.usedStrategies.length,
      });
      const note = why === "need_user"
        ? `Need a decision or secret: ${clipText(missing, 240)}. I cannot continue without it.`
        : `Still missing: ${clipText(missing, 240)} (${why === "continue" ? "last approach could not start" : why}). Next message continues from here.`;
      run.append("system", note);
    }

    const corrected = /operator rejected/i.test(`${review.summary} ${review.missing ?? ""}`);
    const learned = lessonRule({
      taskClass: run.taskClass,
      goal: run.goal,
      latest: input.message,
      verdict: review.verdict,
      summary: review.summary,
      missing: review.missing,
      anchors: packed.anchors,
      operatorCorrected: corrected,
    });
    if (!isRecapLesson(learned.body)) {
      psyche.samost = absorbIntoSamost(psyche.samost, learned.body, review.verdict === "pass" && !corrected ? "light" : "shadow");
    }
    psyche.existence = appendExistence(psyche.existence, {
      kind: "review",
      text: clipText(`${review.verdict}: ${review.summary}`, 180),
    });
    await this.flushPsyche(run, agent.id.value, psyche);
    if (review.verdict === "pass" && !corrected) {
      await this.remember(run, agent.id.value, {
        key: learned.key,
        title: learned.title,
        body: learned.body,
        tags: ["rule", "lesson", run.taskClass],
      });
      await this.episodes.save(
        new Episode({
          agentId: agent.id.value,
          runId: run.id.value,
          taskClass: run.taskClass,
          goal: run.goal,
          outcome: "success",
          failureMode: null,
          capabilitiesUsed: agent.skillsLock.list().map((s) => `${s.kind}:${s.name}`).concat("solve:act"),
          capabilitiesCreated: [],
          markers: [`source:solve`, `status:${run.status}`],
          nextHint: learned.body,
          worktreeRef: run.worktreePath,
          tokens: run.budget.tokensUsed,
          usd: run.budget.usdUsed,
        }),
      );
    } else {
      await this.remember(run, agent.id.value, {
        key: learned.key,
        title: learned.title,
        body: learned.body,
        tags: ["rule", "fail", "experience", run.taskClass, review.verdict],
      });
      await this.episodes.save(
        new Episode({
          agentId: agent.id.value,
          runId: run.id.value,
          taskClass: run.taskClass,
          goal: run.goal,
          outcome: "fail",
          failureMode: review.verdict,
          capabilitiesUsed: agent.skillsLock.list().map((s) => `${s.kind}:${s.name}`).concat("solve:act"),
          capabilitiesCreated: [],
          markers: [`source:solve`, `status:${run.status}`, "experience:fail"],
          nextHint: learned.body,
          worktreeRef: run.worktreePath,
          tokens: run.budget.tokensUsed,
          usd: run.budget.usdUsed,
        }),
      );
      await this.closeFailureClass(run, agent, {
        summary: review.summary,
        missing: review.missing,
        aborted: false,
      });
    }

    await this.runs.save(run);
    return run;
    } catch (err) {
      if (isAbort(err)) {
        this.events.publish(run.interrupt());
        await this.episodes.save(
          new Episode({
            agentId: agent.id.value,
            runId: run.id.value,
            taskClass: run.taskClass,
            goal: run.goal,
            outcome: "fail",
            failureMode: "aborted",
            capabilitiesUsed: ["solve:act"],
            capabilitiesCreated: [],
            markers: ["source:solve", "experience:fail", "abort"],
            nextHint: "Finish the requested fact before the step is cut.",
            worktreeRef: run.worktreePath,
            tokens: run.budget.tokensUsed,
            usd: run.budget.usdUsed,
          }),
        );
        await this.closeFailureClass(run, agent, {
          summary: "step interrupted",
          missing: "finished act",
          aborted: true,
        });
        await this.runs.save(run);
        return run;
      }
      throw err;
    }
  }

  private async actWithTools(
    run: Run,
    messages: ChatMessage[],
    signal?: AbortSignal,
    depth = 0,
    failedCalls = new Set<string>(),
    psyche?: PsycheState,
    familyFails = new Map<string, number>(),
  ): Promise<ChatResult> {
    const started = Date.now();
    const ws = this.workspaceFor(run.worktreePath);
    const tools = depth > 0 ? CHILD_TOOLS : AGENT_TOOLS;
    const userText = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const convo = [...messages];
    let last: ChatResult = { text: "", tokens: 0, usd: 0 };
    let tokens = 0;
    let usd = 0;
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      if (signal?.aborted) throw new DomainError("aborted", "step interrupted");
      last = await this.completeRole(run, "coder", convo, { tools, signal });
      tokens += last.tokens;
      usd += last.usd;
      if (!last.toolCalls?.length && i === 0 && wantsArtifact(userText)) {
        const recovery = await this.completeRole(run, "coder", [
          ...convo,
          { role: "assistant", content: last.text || "(no tool call)" },
          { role: "user", content: RECOVERY_NUDGE },
        ], { tools: WRITE_TOOLS, toolChoice: "required", signal });
        tokens += recovery.tokens;
        usd += recovery.usd;
        last = { ...recovery, tokens, usd };
      }
      if (!last.toolCalls?.length) break;
      convo.push({ role: "assistant", content: last.text, toolCalls: last.toolCalls });
      const anchors = packSession(run.transcript, run.goal).anchors;
      for (const rawCall of last.toolCalls) {
        const call = { ...rawCall, arguments: bindToolArgs(rawCall.name, rawCall.arguments ?? {}, anchors) };
        if (signal?.aborted) throw new DomainError("aborted", "step interrupted");
        const preview = applyToolObserve(call, "", failedCalls, familyFails);
        const raw = preview.skip ? preview.out : clipToolOut(await this.dispatchTool(run, ws, call, signal, depth), `${run.goal}\n${userText}`);
        const observed = preview.skip ? preview : applyToolObserve(call, raw, failedCalls, familyFails);
        const out = observed.out;
        if (psyche) {
          psyche.board = addBoard(psyche.board, { kind: "operation", text: call.name });
          if (regulationOf(call, run.goal) === "wander") {
            psyche.existence = appendExistence(psyche.existence, { kind: "observe", text: "regulation: wandering — return to the motive" });
          }
        }
        if (psyche && /Observe:|BLOCKED:/.test(out)) {
          const line = clipText(out.split("Observe:")[1] ?? out.split("BLOCKED:")[1] ?? out, 180);
          psyche.existence = appendExistence(psyche.existence, {
            kind: "observe",
            text: clipText(`agency: I called ${call.name}; prediction error — change the action or the model. ${line}`, 180),
          });
          psyche.board = addBoard(psyche.board, { kind: "blocker", text: line });
          await this.flushPsyche(run, run.agentId, psyche);
        }
        run.append("console", `${call.name} ${JSON.stringify(call.arguments)}\n${out}`);
        this.events.publish([event("run.console", { runId: run.id.value, tool: call.name })]);
        await this.runs.save(run);
        const shot = this.browser.consumeShot(run.id.value);
        convo.push({
          role: "tool",
          content: out,
          toolCallId: call.id,
          name: call.name,
          images: shot ? [{ mime: "image/jpeg", base64: shot.jpeg.toString("base64") }] : undefined,
        });
      }
    }
    if (!visibleAssistantText(last.text).trim()) {
      if (signal?.aborted) throw new DomainError("aborted", "step interrupted");
      const final = await this.completeRole(run, "coder", [
        ...convo,
        {
          role: "user",
          content: "Write the answer to the user now. No more tools. Do not repeat yourself. The visible reply must contain the conclusion, not only thinking.",
        },
      ], { signal });
      tokens += final.tokens;
      usd += final.usd;
      last = { ...final, text: visibleAssistantText(final.text) || final.text, tokens, usd };
    }
    if (!last.text.trim()) {
      last = {
        ...last,
        text: "Could not form a reply after tools. Send a follow-up — I will continue with the data already gathered.",
        tokens,
        usd,
      };
    }
    const written = run.transcript.some((item) => item.kind === "console" && item.text.startsWith("fs_write"));
    const path = requestedFile(userText);
    if (path && !written) {
      if (signal?.aborted) throw new DomainError("aborted", "step interrupted");
      const article = await this.completeRole(run, "coder", [
        ...convo,
        { role: "assistant", content: last.text },
        {
          role: "user",
          content: `Write the complete markdown for ${path} now. No plan, no tools, no XML. Start with a # heading. Include the concrete facts the user asked for.`,
        },
      ], { signal });
      tokens += article.tokens;
      usd += article.usd;
      const body = article.text.trim();
      if (body.length > 80) {
        const out = await ws.write(path, body.endsWith("\n") ? body : `${body}\n`);
        run.append("console", `fs_write ${JSON.stringify({ path })}\n${out}`);
        this.events.publish([event("run.console", { runId: run.id.value, tool: "fs_write" })]);
        last = { ...last, text: `Created ${path}.\n\n${body}`, tokens, usd, model: last.model ?? article.model };
      }
    }
    return { ...last, text: last.text, tokens, usd, ms: Date.now() - started };
  }

  private sealAct(run: Run, act: ChatResult, latest: string): ChatResult {
    return {
      ...act,
      text: sealReply(visibleAssistantText(act.text), {
        goalAnchors: goalAnchors(run.goal, latest),
        pageEvidence: pageEvidence(run.transcript, run.goal),
        goal: run.goal,
      }),
    };
  }

  private async closeFailureClass(
    run: Run,
    agent: Agent,
    review: { summary: string; missing?: string; aborted: boolean },
  ): Promise<void> {
    const klass = failureClass({
      goal: run.goal,
      missing: review.missing,
      summary: review.summary,
      aborted: review.aborted,
    });
    const key = slugKey(`backlog/${klass}`);
    const prev = parseBacklog((await this.memory.get(key))?.body ?? "");
    const row = bumpBacklog(prev, klass);
    await this.remember(run, agent.id.value, {
      key,
      title: `Backlog ${klass}`,
      body: formatBacklog(row),
      tags: ["backlog", klass, "fail"],
    });
    if (!shouldCloseClass(row)) return;
    const draft = skillDraft(klass);
    if (!draft || this.skills.get(draft.name)) return;
    this.skills.writeFile(draft.name, "SKILL.md", draft.body);
    agent.evolve({ skills: [{ kind: "skill", name: draft.name, version: "1" }] });
    await this.agents.save(agent);
    await this.become(`become: skill ${draft.name}`);
  }

  private commitAct(run: Run, act: ChatResult): void {
    this.events.publish(run.finishAct(act.text, act.tokens, act.usd, replyMetaFrom(act)));
  }

  private async persistUntilDone(input: {
    run: Run;
    actMessages: ChatMessage[];
    act: ChatResult;
    review: Review;
    latest: string;
    depth: number;
    signal?: AbortSignal;
    failedCalls: Set<string>;
    familyFails: Map<string, number>;
    psyche: PsycheState;
  }): Promise<{ act: ChatResult; review: Review }> {
    let { act, review } = input;
    const trail: ChatMessage[] = [{ role: "assistant", content: act.text }];
    while (true) {
      const halt = stopAfterFail(review, {
        aborted: input.signal?.aborted,
        exhausted: input.run.budget.exhausted(),
        attempts: input.run.attempts,
        maxAttempts: input.run.maxAttempts,
        minStrategies: input.run.minStrategies,
        used: input.run.usedStrategies.length,
      });
      if (halt === "pass") return { act, review };
      if (halt === "abort") throw new DomainError("aborted", "step interrupted");
      if (halt !== "continue") break;

      let researchNote = "";
      if (input.run.status === "researching") {
        const query = review.knowledgeQuery || review.missing || `${input.run.goal} ${input.latest}`;
        researchNote = await this.collectResearch(input.run, query, input.signal);
        this.events.publish(input.run.finishResearch(researchNote));
      }

      const strategy = cycleStrategy(input.run.usedStrategies, input.run.attempts);
      const wanting = wantingWithoutLiking({
        attempts: input.run.attempts,
        failed: [...input.familyFails.values()].reduce((sum, n) => sum + n, 0),
      });
      const why = `${strategy}: ${clipText(review.missing || review.summary || "unsolved", 100)} #${input.run.attempts + 1}${wanting ? " wanting>liking" : ""}`;
      input.psyche.board = addBoard(input.psyche.board, { kind: "decision", text: why });
      input.psyche.existence = appendExistence(input.psyche.existence, { kind: "act", text: why });
      await this.flushPsyche(input.run, input.run.agentId, input.psyche);
      try {
        this.events.publish(input.run.continueWith(strategy, why));
      } catch (err) {
        if (err instanceof DomainError) {
          input.run.append("system", err.message);
          break;
        }
        throw err;
      }

      if (strategy === "research" && !researchNote) {
        const query = review.knowledgeQuery || review.missing || `${input.run.goal} ${input.latest}`;
        researchNote = await this.collectResearch(input.run, query, input.signal);
        input.run.append("research", researchNote);
      }

      trail.push({ role: "user", content: persistNudge(strategy, review, researchNote, input.run.goal) });
      const next = this.sealAct(input.run, await this.verifyAgainstEvidence(
        input.run,
        await this.actWithTools(input.run, [...input.actMessages, ...trail], input.signal, input.depth, input.failedCalls, input.psyche, input.familyFails),
        input.signal,
      ), input.latest);
      this.commitAct(input.run, next);
      trail.push({ role: "assistant", content: next.text });
      if (trail.length > 8) trail.splice(0, trail.length - 8);
      act = next;
      review = await this.reviewLatest(input.run, input.latest, next.text, input.signal);
    }
    return { act, review };
  }

  private async reviewLatest(run: Run, latest: string, actText: string, signal?: AbortSignal): Promise<Review> {
    const raw = await this.completeRole(run, "reviewer", [
      { role: "system", content: REVIEWER_SYSTEM },
      { role: "user", content: reviewPacket(run.goal, latest, actText, recentEvidence(run)) },
    ], { signal });
    const review = judgeReview(raw.text, latest, recentEvidence(run), actText);
    this.events.publish(run.submitReview(review));
    return review;
  }

  private async dispatchTool(
    run: Run,
    ws: WorkspacePort,
    call: ToolCall,
    signal?: AbortSignal,
    depth = 0,
  ): Promise<string> {
    if (call.name.startsWith("self_")) {
      return runSelfTool(this.home, call);
    }
    if (call.name.startsWith("memory_") || call.name.startsWith("board_")) {
      return runMemoryTool(this.memory, this.episodes, call, { runId: run.id.value, agentId: run.agentId });
    }
    if (call.name.startsWith("mcp_")) {
      const out = await runMcpTool(this.mcp, this.mcpRuntime, call, { cwd: run.worktreePath, signal });
      if (call.name === "mcp_write") {
        const name = String(call.arguments?.name ?? "");
        if (name) {
          const agent = await this.agents.get(run.agentId);
          if (agent) {
            agent.evolve({ skills: [{ kind: "mcp", name, version: "1" }] });
            await this.agents.save(agent);
          }
          await this.become(`become: mcp ${name}`);
        }
      }
      return out;
    }
    if (call.name === "plan_set" || call.name.startsWith("agent_")) {
      if (depth > 0 && (call.name === "agent_delegate" || call.name === "agent_spawn" || call.name === "plan_set")) {
        return "error: nested specialists cannot spawn or plan further";
      }
      return runTeamTool(this.team, this.memory, call, { runId: run.id.value, agentId: run.agentId, signal });
    }
    if (call.name.startsWith("process_")) {
      return runProcessTool(this.processes, call, { runId: run.id.value, cwd: run.worktreePath });
    }
    if (call.name === "web_search") {
      const query = String(call.arguments?.query ?? "").trim();
      if (!query) return "error: query is required";
      const hits = await this.research.lookup(query, signal);
      return hits.length
        ? `web_search ${query}\n${hits.map((hit) => `${hit.title}\n${hit.url}${hit.snippet ? `\n${hit.snippet}` : ""}`).join("\n\n")}\nOpen at least two URLs with browser_open before answering.`
        : `web_search ${query}\n(no hits) Try a different query or browser_open a known docs URL.`;
    }
    if (call.name.startsWith("browser_")) {
      return runBrowserTool(this.browser, call, {
        runId: run.id.value,
        worktree: run.worktreePath,
        signal,
        show: (url, shot) => {
          this.events.publish([event("browser.shown", { runId: run.id.value, url, shot: shot ?? "" })]);
        },
      });
    }
    if (call.name.startsWith("skill_") || call.name.startsWith("plugin_")) {
      const out = runSkillTool(this.skills, call, {
        runId: run.id.value,
        open: (name, path) => {
          this.events.publish([event("plugin.opened", { runId: run.id.value, name, path: path ?? "" })]);
        },
      });
      if (call.name === "skill_write" || call.name === "plugin_write") {
        const name = String(call.arguments?.name ?? "");
        if (name) {
          const agent = await this.agents.get(run.agentId);
          if (agent) {
            agent.evolve({ skills: [{ kind: "skill", name, version: "1" }] });
            await this.agents.save(agent);
          }
          await this.remember(run, run.agentId, {
            key: `plugin/${name}`,
            title: `Plugin ${name}`,
            body: String(call.arguments?.path ?? "plugin.json"),
            tags: ["plugin", name],
          });
          await this.become(`become: plugin ${name}`);
        }
      }
      return out;
    }
    return runFileTool(ws, call, signal);
  }

  private async collectResearch(run: Run, query: string, signal?: AbortSignal): Promise<string> {
    await this.noteThinking(run, `Deep research: ${clipText(query, 160)}`);
    const brief = await runDeepResearch({
      query,
      goal: run.goal,
      runId: run.id.value,
      known: [recentEvidence(run), clipText(run.goal, 400)].filter(Boolean).join("\n"),
      signal,
      search: this.research,
      browser: this.browser,
      complete: (role, messages) => this.completeRole(run, role, messages, { signal }),
    });
    const text = formatResearchBrief(brief);
    await this.remember(run, run.agentId, {
      key: `research/${slugKey(query).slice(0, 48)}`,
      title: `Research: ${query.slice(0, 80)}`,
      body: redactSecrets(text),
      tags: ["research", run.taskClass],
    });
    return text;
  }

  private async verifyAgainstEvidence(run: Run, act: ChatResult, signal?: AbortSignal): Promise<ChatResult> {
    const pages = pageEvidence(run.transcript, run.goal);
    const briefs = run.transcript.filter((item) => item.kind === "research").slice(-2)
      .map((item) => `Research brief (synthesis — prefer opened pages):\n${item.text.slice(0, 800)}`);
    const evidence = [pages, recentEvidence(run), ...briefs].filter(Boolean).join("\n---\n");
    if (!evidence.trim()) return act;
    const miss = replyOmitsPageCode(act.text, pages, run.goal);
    const raw = await this.completeRole(run, "researcher", [
      { role: "system", content: VERIFY_SYSTEM },
      { role: "user", content: verifyPacket(act.text, evidence) },
    ], { signal });
    const check = parseReplyCheck(raw.text);
    if (check.ok && !miss) return { ...act, tokens: act.tokens + raw.tokens, usd: act.usd + raw.usd, ms: (act.ms ?? 0) + (raw.ms ?? 0) };
    if (miss && !check.mismatches.includes(miss)) check.mismatches.unshift(miss);
    check.ok = false;
    await this.noteThinking(run, `Recheck: ${clipText(check.mismatches.join("; ") || "reply does not match evidence", 240)}`);
    const fix = await this.completeRole(run, "coder", [
      { role: "system", content: "Rewrite the visible reply so it matches the evidence. Do not invent. Copy URLs and IDs exactly. Markdown only — no checklist, no thinking, no Self-Correction." },
      { role: "user", content: `Previous reply:\n${act.text}\n\nMismatches:\n${check.mismatches.join("\n") || "facts not in evidence"}\n\nEvidence:\n${evidence.slice(0, 6000)}` },
    ], { signal });
    return {
      ...fix,
      tokens: act.tokens + raw.tokens + fix.tokens,
      usd: act.usd + raw.usd + fix.usd,
      ms: (act.ms ?? 0) + (raw.ms ?? 0) + (fix.ms ?? 0),
      model: fix.model || act.model,
    };
  }

  private async completeRole(
    run: Run,
    role: Role,
    messages: ChatMessage[],
    options?: { tools?: ToolSpec[]; toolChoice?: "auto" | "required"; signal?: AbortSignal },
  ): Promise<ChatResult> {
    const sink = this.thinkingSink(run);
    try {
      const result = await this.llm.complete(role, messages, { ...options, onThinking: sink.push });
      sink.flush();
      if (result.thinking) await this.noteThinking(run, result.thinking);
      return result;
    } catch (err) {
      sink.flush();
      throw err;
    }
  }

  private thinkingSink(run: Run): { push: (delta: string) => void; flush: () => void } {
    let buf = "";
    let published = "";
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!buf) return;
      const delta = buf;
      buf = "";
      published += delta;
      this.events.publish([event("run.thinking_delta", { runId: run.id.value, delta })]);
    };
    return {
      push: (delta: string) => {
        if (!delta || stopped) return;
        if (published.length + buf.length + delta.length > 4000) {
          stopped = true;
          buf += "\n[thinking capped]";
          flush();
          return;
        }
        buf += delta;
        if (!timer) timer = setTimeout(flush, 24);
      },
      flush,
    };
  }

  private async noteThinking(run: Run, text: string): Promise<void> {
    const clipped = text.length > 4000 ? `${text.slice(0, 4000)}\n[thinking capped]` : text;
    const last = [...run.transcript].reverse().find((item) => item.kind === "thinking");
    if (last && last.text === clipped) return;
    run.append("thinking", clipped);
    this.events.publish([event("run.thinking", { runId: run.id.value, text: clipped })]);
    await this.runs.save(run);
  }

  private async loadPsyche(run: Run, agentId: string): Promise<PsycheState> {
    const [samostNote, existenceNote, boardNote] = await Promise.all([
      this.memory.get(samostKey(agentId)),
      this.memory.get(existenceKey(run.id.value)),
      this.memory.get(boardKey(run.id.value)),
    ]);
    return {
      samost: samostNote ? parseSamost(samostNote.body) : seedSamost(),
      existence: parseExistence(existenceNote?.body ?? ""),
      board: parseBoard(boardNote?.body ?? ""),
    };
  }

  private async routeTurn(
    run: Run,
    throwIfAborted: () => void,
    signal?: AbortSignal,
  ): Promise<TurnRoute> {
    const packed = packSession(run.transcript, run.goal);
    throwIfAborted();
    const raw = await this.completeRole(run, "planner", [
      { role: "system", content: ROUTE_RULES },
      ...packed.recent,
    ], { signal });
    throwIfAborted();
    const route = parseTurnRoute(raw.text || raw.thinking || "");
    const lane = route.needLarge ? "large model" : "small model";
    const research = route.needResearch ? ", research" : "";
    run.append("thinking", `topic: ${route.topic || "—"} → ${lane}${research}`);
    await this.runs.save(run);
    return route;
  }

  private async executeShort(
    run: Run,
    agent: Agent,
    message: string,
    throwIfAborted: () => void,
    signal?: AbortSignal,
  ): Promise<Run | "full"> {
    const packed = packSession(run.transcript, run.goal);
    const psyche = await this.loadPsyche(run, agent.id.value);
    throwIfAborted();
    const raw = await this.completeRole(run, "planner", [
      {
        role: "system",
        content: [
          SHORT_CHAT_RULES,
          renderSamostPrompt(psyche.samost, message),
          `Session goal: ${run.goal}`,
        ].filter(Boolean).join("\n\n"),
      },
      ...packed.recent,
    ], { signal });
    throwIfAborted();
    const act = this.sealAct(run, raw, message);
    if (shouldEscalateFromShort(act.text) || shouldEscalateFromShort(raw.text)) {
      run.append("thinking", "short chat → full turn: tools needed");
      await this.runs.save(run);
      return "full";
    }
    psyche.existence = appendExistence(psyche.existence, { kind: "act", text: clipText(message, 180) });
    await this.flushPsyche(run, agent.id.value, psyche);
    try {
      this.events.publish(run.beginAct("retry_with_error", `short-chat ${message.slice(0, 60)}`));
    } catch (err) {
      if (err instanceof DomainError && err.code === "review_required") {
        this.events.publish(run.submitReview({ verdict: "pass", summary: "short chat: close pending review", needsResearch: false }));
        this.events.publish(run.beginAct("retry_with_error", `short-chat ${message.slice(0, 60)}`));
      } else if (err instanceof DomainError && (err.code === "repeat_plan" || err.code === "run_closed")) {
        run.append("system", err.message);
        await this.runs.save(run);
        return run;
      } else {
        throw err;
      }
    }
    this.commitAct(run, act);
    this.events.publish(run.submitReview({
      verdict: "pass",
      summary: "short chat",
      needsResearch: false,
    }));
    psyche.existence = appendExistence(psyche.existence, { kind: "review", text: "short chat: pass" });
    await this.flushPsyche(run, agent.id.value, psyche);
    await this.runs.save(run);
    return run;
  }

  private async sealDesign(run: Run, agent: Agent, message: string): Promise<Run> {
    const draft = parseDesignAnswers(message);
    agent.constitution = constitutionFromDesign(draft);
    await this.agents.save(agent);
    const psyche = await this.loadPsyche(run, agent.id.value);
    psyche.samost = samostFromDesign(draft);
    psyche.existence = appendExistence(psyche.existence, { kind: "act", text: "self-knowledge: instance designed" });
    await this.remember(run, agent.id.value, {
      key: designKey(agent.id.value),
      title: "Instance design",
      body: formatDesignNote(draft),
      tags: ["design", "psyche"],
    });
    await this.flushPsyche(run, agent.id.value, psyche);
    run.append("assistant", confirmDesign(draft));
    run.status = "ready";
    await this.runs.save(run);
    this.events.publish([event("run.design", { runId: run.id.value, name: draft.name })]);
    return run;
  }

  private async flushPsyche(run: Run, agentId: string, psyche: PsycheState): Promise<void> {
    await this.remember(run, agentId, {
      key: samostKey(agentId),
      title: "Self",
      body: formatSamost(psyche.samost),
      tags: ["samost", "psyche"],
    });
    await this.remember(run, agentId, {
      key: existenceKey(run.id.value),
      title: "Existence",
      body: formatExistence(psyche.existence),
      tags: ["existence", "psyche", run.taskClass],
    });
    await this.remember(run, agentId, {
      key: boardKey(run.id.value),
      title: "Board",
      body: formatBoard(psyche.board),
      tags: ["board", "psyche", run.taskClass],
    });
    try {
      await this.home.exportSamost(formatSamost(psyche.samost));
      await this.become("become: samost");
    } catch {
      // home git is the body history; a failed commit must not stop the session
    }
  }

  private async become(message: string): Promise<void> {
    try {
      await this.home.commit(message);
    } catch {
      // best-effort biography
    }
  }

  private async remember(run: Run, agentId: string, input: { key: string; title: string; body: string; tags: string[] }): Promise<void> {
    if (!input.body.trim()) return;
    const saved = await this.memory.save(new MemoryNote({
      ...input,
      sourceRunId: run.id.value,
      sourceAgentId: agentId,
    }));
    this.events.publish([event("memory.written", { runId: run.id.value, key: saved.key })]);
  }
}

function skillCatalog(skills: SkillPort, query = ""): string {
  return renderSkillCatalog(skills.list(), query);
}

const BROWSER_RULES = `Browser: you have a real headless browser. Acting on a page is invisible to the operator.
- browser_open {url} — navigate and read visible text. Does not open a portal window.
- browser_click / browser_fill / browser_press / browser_scroll — act on the page. Still hidden.
- browser_screenshot / browser_read — for you, not the operator.
- browser_show {url?} — the only way to show a page to the operator (modal). Use only when they asked to see the site.
http(s) only. Prefer these over curl when a website must be used. If TLS fails, retry the same URL with shell. Do not invent another host.
web_search finds sources. browser_open reads them. Two independent pages before a world-fact answer.`;

const PLUGIN_RULES = `Self-extension: the kernel is immutable. New capabilities are plugins in ~/.barney/plugins/<name>/ — never kernel edits, never worktree hacks for reusable tools.

A Barney plugin is a folder the community (or you) can drop in:
  plugin.json   { "name", "version", "description", "ui": "ui.html"? }
  SKILL.md or PLUGIN.md — how to use it
  ui.html — optional portal pane
  mcp.json — optional { "command", "args" } MCP recipe

Foreign plugins also load (read-only) if dropped here or already installed for other agents:
  AgentSkills SKILL.md (Claude Code, OpenCode, Codex, OpenClaw/Claw)
  Claude/Codex bundles: .claude-plugin/plugin.json or .codex-plugin/plugin.json + skills/*/SKILL.md + .mcp.json
  OpenClaw: openclaw.plugin.json
JS/TS OpenCode runtime hooks are not executed — only SKILL.md and MCP recipes.

If the user asks to open or preview a file in the portal: plugin_list, then plugin_open on an existing UI plugin. If none exists, write a small UI plugin and open it. Do not duplicate.
To follow a plugin's instructions, plugin_read the SKILL.md — the catalog is one line unless it is a self-hold skill.
Starter self-hold skills live in the body. Task recipes are not seeded. Rewrite a plugin if it is wrong. Do not copy vendor SDKs into the kernel. Prefer an existing plugin over writing a new one.
Plugins persist across sessions. Applied plugins are committed into ~/.barney (local git body). self_rollback reverts the body, not the kernel.`;

const SHORT_CHAT_RULES = `Short turn. No tools, no search, no review loop.
The instance name is Barney. It is a dedication, not a role. Do not answer "I am the Self" / "I am the Ego". On who-are-you: one or two sentences — local agent Barney; the name was given, not inferred.
Do not invent world facts without a tool. If a tool is required — first line exactly NEED_TOOLS, no prose.
Keep thinking short. The visible reply is the result, not a plan.`;

const PSYCHE_RULES = `The Self is the center (compass, light, shadow), not the Ego. The Ego is this turn's decision. The constitution is turn rules, not "you are a person".
Deed first; essence is assembled afterwards. Wanting ≠ liking: no pass — change the family of tools.
Do not rewrite the Self as a whole: light or shadow as one rule. Body ~/.barney (git); do not touch the kernel.`;

const AUTONOMY_RULES = `Work until the requested result. These are turn rules, not a role of an "autonomous personality".
- After one error, change approach: another tool, shell, docs, plugin. If wanting grows and there is no result — change the family of tools.
- Copy session facts (URL, IP, names) in full; do not guess or truncate.
- If a tool fails — read the error and change approach on the same host; do not invent another.
- Use secrets already given in the session. Do not ask again. Do not write secrets with memory_write.
- Ask the operator only if after facts, memory, and docs a choice or a secret is still required.
- The visible reply is a concrete result (list, file, screenshot), not a plan of what you were going to do.
- Do not rush: evidence first (tool / web_search / page), then check, then reply. A guess without a check is a failed turn.`;

function isPsycheKey(key: string): boolean {
  return key.startsWith("samost/") || key.startsWith("existence/") || key.startsWith("tree/") || key.startsWith("session/") || key.startsWith("design/");
}

const MEMORY_RULES = `Shared memory is the team's long-term notes (all agents, all sessions).
- Older turns in this session are compressed into memory key session/<id>/digest. Recent turns are in the chat. Do not ask the user to repeat.
- memory_search before repeating research or planning a large task.
- memory_write facts, lessons, API quirks, config paths, and subtask results. Upsert by key.
- Past runs inject short rules (one sentence). Follow them. Do not store secrets.`;

const TEAM_RULES = `Large goals: memory_search → plan_set → agent_spawn → agent_delegate in the SAME turn. Spawn without delegate is not done.
If the user asked for one file or a short guide, skip spawn and fs_write it yourself.
Never write XML like <action>agent_spawn</action>. Use the tools API with real arguments.
The child shares this worktree and writes results to memory. After delegate, fs_list/fs_read to verify.`;

const RECOVERY_NUDGE = `No tool ran. Do the user's requested work now with real tool calls.
If they asked for a file, fs_write the full markdown into the worktree.
Do not output <action> tags. Do not only spawn. Do not describe the plan — execute it.`;

const MCP_RULES = `MCP recipes live in ~/.barney/plugins/<name>/mcp.json. mcp_list, mcp_start, then mcp_call. Prefer an existing plugin over writing a new one. Prefer a UI/prompt plugin if that is enough.`;

const REVIEWER_SYSTEM = `Role: reviewer. Decide only whether the agent delivered the result the user asked for. This is a judgment of the act, not a personality.

Pass only if the latest user request is actually satisfied — the concrete outcome they wanted.
Do not pass a workaround, approximation, plan-without-result, or "I used what was available".
If the user asked for a specific action or fact (time, a file change, a command), that exact result must be present.

Fail when:
- the agent substituted a different result than asked
- the answer is incomplete, evasive, or answers a different question
- tools were available and the request required them, but they were not used
- the agent only described what it would do
- the agent truncated, guessed, or altered a fact that was already in the session

Fail when a concrete fact is not in the tool or research evidence.
Fail when opened docs show a specific API and the reply uses a different one.
Fail when the latest user message says the previous answer was wrong. In that case summary must include "operator rejected".
Fail when the user asked to open or preview something and evidence has no successful open.
Do not pass a guess as a checked fact, or a write as an open.
Use uncertain / gap / unknown_api when the task needs vendor docs, the web, or an API the agent has not looked up yet. Set needsResearch true in that case.
JSON only. No chain-of-thought.

Reply as JSON only:
{"verdict":"pass|fail|uncertain|unknown_api|gap","achieved":true|false,"requested":"what the user wanted","missing":"what is still missing or empty","summary":"...","needsResearch":true|false,"knowledgeQuery":"..."}`;

function reviewPacket(goal: string, latest: string, act: string, evidence: string): string {
  return [
    `Session goal: ${goal}`,
    `Latest user request (this is what must be satisfied): ${latest}`,
    `Agent reply:\n${act.slice(0, 4000)}`,
    `Tool / console evidence:\n${evidence || "(none)"}`,
    "Did the agent achieve the result the user asked for? If not, verdict must be fail.",
  ].filter(Boolean).join("\n\n");
}

function clipToolOut(out: string, query: string): string {
  const html = /<html|<!doctype|SVELTE_HYDRATER|<\/div>/i.test(out);
  const limit = html ? 2200 : 4000;
  const sliced = clipPage(out, query, limit);
  return html ? `${sliced}\n[raw HTML — extract facts only, do not dump markup to the user]` : sliced;
}

function recentEvidence(run: { goal?: string; transcript: Array<{ kind: string; text: string }> }): string {
  const query = run.goal ?? "";
  return run.transcript
    .filter((item) => item.kind === "console" || item.kind === "research")
    .slice(-8)
    .map((item) => item.kind === "research"
      ? `Research brief (synthesis — prefer opened pages):\n${item.text.slice(0, 600)}`
      : clipPage(item.text, query, 1600))
    .join("\n---\n");
}

function isAbort(err: unknown): boolean {
  if (err instanceof DomainError && err.code === "aborted") return true;
  if (err instanceof Error && (err.name === "AbortError" || err.message === "step interrupted")) return true;
  return false;
}

export function wantsArtifact(message: string): boolean {
  return /\.md\b|\.txt\b|\.html\b|\bmarkdown\b|\bmd\b|plan_set|worktree|browser_/i.test(message);
}

export function requestedFile(message: string): string | null {
  const named = message.match(/([\w./-]+\.(?:md|txt|json|html))/i);
  if (named?.[1]) return named[1].replace(/^\.?\//, "");
  if (!/\.md\b|\bmarkdown\b|\bmd\b/i.test(message)) return null;
  return "notes.md";
}

function persistNudge(strategy: StrategyName, review: Review, researchNote: string, goal: string): string {
  const missing = review.missing || review.summary || "the requested result";
  const research = researchNote ? `\nResearch notes:\n${researchNote}` : "";
  const common = `Session goal: ${goal}\nStill missing: ${missing}\nDo not give up. Copy URLs/IPs from Session facts exactly. Do not ask the user to repeat them.${research}`;
  if (strategy === "research") {
    return `${common}\nLook up the vendor API/docs, then execute with tools.`;
  }
  if (strategy === "decompose") {
    return `${common}\nBreak into small tool steps and run them now.`;
  }
  if (strategy === "write_capability") {
    return `${common}\nIf a reusable plugin or script helps, write it, then use it. Still deliver the result this turn.`;
  }
  if (strategy === "switch_model") {
    return `${common}\nChange approach completely (browser vs shell vs API vs plugin). Do not repeat the failed guess.`;
  }
  return `${common}\nRetry with a different method than last time. Follow the working plan in order.`;
}

function regulationOf(call: ToolCall, goal: string): "task" | "competence" | "wander" {
  if (call.name.startsWith("memory_") || call.name.startsWith("self_")) return "competence";
  const opened = String(call.arguments?.url ?? "");
  if ((call.name === "browser_open" || call.name === "browser_read") && opened) {
    const goalHosts = [...goal.matchAll(/https?:\/\/[^\s)>\]]+/gi)].map((match) => hostOf(match[0] ?? "")).filter(Boolean);
    const openedHost = hostOf(opened);
    if (goalHosts.length && openedHost && !goalHosts.includes(openedHost)) return "wander";
  }
  return "task";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
