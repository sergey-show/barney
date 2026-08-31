import { buildActSystem, turnLawFromConstitution, workspaceLines } from "../context/actPrompt.ts";
import { cycleStrategy, familyKey, stopAfterFail, wantingWithoutLiking, type HaltReason } from "../context/controlLoop.ts";
import { draftPlan, formatPlan } from "../context/draftPlan.ts";
import { bindToolArgs, goalAnchors } from "../context/bindAnchor.ts";
import { bumpBacklog, failureClass, formatBacklog, learnedSkillDraft, parseBacklog } from "../context/failureClass.ts";
import { emptyTrail, lessonRule, noteTrail, pickRules, isRecapLesson, type LessonTrail } from "../context/lessonRule.ts";
import { sealReply } from "../context/sealReply.ts";
import { judgeReview, artifactPins, missingIsLocalArtifact, requestedArtifacts, stillMissingArtifacts, unwrittenArtifacts } from "../context/reviewJudge.ts";
import { applyToolObserve, attachObserve, classifyToolResult } from "../context/observeTool.ts";
import { rememberGood, rememberPrevious, restoreBody, pathsWithRestore } from "../context/fileCheckpoint.ts";
import {
  absoluteFilePathsInCommand,
  checkFailedPaths,
  clearFailedEdit,
  failedEditPaths,
  markCheckFailed,
  markFailedEdit,
  markPassedRun,
  markUnverified,
  redirectTargetsInCommand,
  runOutputLooksIncomplete,
  shellExitCode,
  shellStdout,
  trackMutated,
  trackedPathsInCommand,
  validationPinLine,
  wasPassedRun,
  unverifiedPaths,
} from "../context/validationLedger.ts";
import { clipText, packSession, redactSecrets } from "../context/packSession.ts";
import { bindFsWriteArgs, extractToolEvidence } from "../context/toolEvidence.ts";
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
import { classKey, pluginMemoryKey } from "../../domain/memory/experienceGraph.ts";
import { MemoryNote, slugKey } from "../../domain/memory/MemoryNote.ts";
import type { ChatMessage, ChatResult, Role } from "../../domain/provider/Role.ts";
import type { ToolSpec } from "../../domain/tools/FileTools.ts";
import type { Agent } from "../../domain/agent/Agent.ts";
import type { Review, FailureKind } from "../../domain/run/Review.ts";
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
  ExperienceGraph,
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
    private readonly graph: ExperienceGraph,
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
    if (depth === 0) {
      routed = await this.routeTurn(run, throwIfAborted, input.signal);
      if (!input.forceFull && routed.short) {
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
    const relatedKeys = await this.graph.neighborhood([
      classKey(run.taskClass),
      ...past.slice(0, 6).flatMap((episode) => episode.failureMode ? [classKey(episode.failureMode)] : []),
    ], 2);
    const hopNotes = (await Promise.all(relatedKeys.map((key) => this.memory.get(key)))).filter(
      (note): note is NonNullable<typeof note> => Boolean(note),
    );
    const rules = pickRules([...recentMemories, ...hopNotes], run.taskClass, 5, relatedKeys);
    const psyche = await this.loadPsyche(run, agent.id.value);
    psyche.existence = appendExistence(psyche.existence, { kind: "act", text: clipText(input.message, 180) });
    psyche.board = addBoard(psyche.board, { kind: "motive", text: clipText(run.goal, 200) });
    psyche.board = addBoard(psyche.board, { kind: "action", text: clipText(input.message, 180) });
    for (const anchor of packed.anchors) {
      psyche.board = addBoard(psyche.board, { kind: "fact", text: anchor });
    }
    await this.flushPsyche(run, agent.id.value, psyche);
    const planKey = `plan/${run.id.value}`;
    const failMarkers = past
      .filter((episode) => episode.outcome === "fail")
      .slice(0, 4)
      .map((episode) => episode.nextHint || episode.failureMode || "")
      .filter(Boolean);
    const analyzedSteps = (routed?.plan ?? []).map((step) => step.trim()).filter(Boolean);
    const planText = [
      routed?.analysis ? `Analysis: ${routed.analysis}` : "",
      formatPlan(analyzedSteps.length ? analyzedSteps : draftPlan({
        goal: run.goal,
        latest: input.message,
        anchors: packed.anchors,
        markers: failMarkers,
      })),
    ].filter(Boolean).join("\n");
    await this.remember(run, agent.id.value, {
      key: planKey,
      title: `Plan for session ${run.id.value}`,
      body: planText,
      tags: ["plan", run.taskClass],
    });
    const memoryNote = [
      rules.length ? `Rules from past runs of this task class (obey these):\n${rules.map((line) => `- ${line}`).join("\n")}` : "",
      packed.digest ? `Session so far (compressed; full chat stays in the portal):\n${packed.digest}` : "",
      ...shared.map((note) => `[${note.key}] ${note.title}: ${note.body.slice(0, 160)}`),
      ...past.slice(0, 3).map((e) => `[${e.outcome}] ${e.goal} → ${e.nextHint}`),
    ].filter(Boolean).join("\n\n");
    const failedCalls = new Set<string>();
    const familyFails = new Map<string, number>();
    const extra = { n: 0 };
    const lessonTrail = emptyTrail();
    const failKlass = { last: "" };

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
        content: buildActSystem({
          constitution: agent.constitution,
          samost: renderSamostPrompt(psyche.samost, `${run.goal}\n${input.message}`),
          existence: renderExistencePrompt(psyche.existence),
          board: renderBoardPrompt(psyche.board),
          goal: run.goal,
          anchors: packed.anchors,
          plan: planText,
          worktree: run.worktreePath,
          sessionDir: run.sessionPath,
          depth,
          skills: skillCatalog(this.skills, `${run.goal}\n${input.message}`),
          memory: memoryNote,
        }),
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
    let act = await this.actWithTools(run, actMessages, input.signal, depth, failedCalls, psyche, familyFails, lessonTrail);
    throwIfAborted();
    act = this.sealAct(run, await this.verifyAgainstEvidence(run, act, input.signal), input.message);
    throwIfAborted();
    this.commitAct(run, act);

    const reviewPrompt: ChatMessage[] = [
      { role: "system", content: REVIEWER_SYSTEM },
          { role: "user", content: reviewPacket(run.goal, input.message, act.text, reviewEvidence(run, input.message)) },
    ];
    throwIfAborted();
    const reviewRaw = await this.completeRole(run, "reviewer", reviewPrompt, { signal: input.signal });
    let review = judgeReview(reviewRaw.text, input.message, artifactEvidence(run), act.text, reviewOpts(run.id.value));
    rememberFailKlass(failKlass, review);
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
          extra.n += 1;
          throwIfAborted();
          const second = this.sealAct(run, await this.verifyAgainstEvidence(run, await this.actWithTools(run, [
            ...actMessages,
            { role: "assistant", content: act.text },
            { role: "user", content: `Research notes:\n${note}\nContinue solving. Do not repeat the previous plan.` },
          ], input.signal, depth, failedCalls, psyche, familyFails, lessonTrail), input.signal), input.message);
          this.commitAct(run, second);
          throwIfAborted();
          const review2Raw = await this.completeRole(run, "reviewer", [
            { role: "system", content: reviewPrompt[0].content },
            { role: "user", content: reviewPacket(run.goal, input.message, second.text, reviewEvidence(run, input.message)) },
          ], { signal: input.signal });
          const review2 = judgeReview(review2Raw.text, input.message, artifactEvidence(run), second.text, reviewOpts(run.id.value));
          rememberFailKlass(failKlass, review2);
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
        extra.n += 1;
        throwIfAborted();
        const retry = this.sealAct(run, await this.verifyAgainstEvidence(run, await this.actWithTools(run, [
          ...actMessages,
          { role: "assistant", content: act.text },
          { role: "user", content: RECOVERY_NUDGE },
        ], input.signal, depth, failedCalls, psyche, familyFails, lessonTrail), input.signal), input.message);
        this.commitAct(run, retry);
        throwIfAborted();
        const retryReviewRaw = await this.completeRole(run, "reviewer", [
          { role: "system", content: reviewPrompt[0].content },
          { role: "user", content: reviewPacket(run.goal, input.message, retry.text, reviewEvidence(run, input.message)) },
        ], { signal: input.signal });
        const retryReview = judgeReview(retryReviewRaw.text, input.message, artifactEvidence(run), retry.text, reviewOpts(run.id.value));
        rememberFailKlass(failKlass, retryReview);
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
        extra,
        psyche,
        lessonTrail,
        failKlass,
      });
      act = persisted.act;
      review = persisted.review;
    }

    if (run.status === "ready" && review.verdict !== "pass") {
      const missing = review.missing || review.summary || "the requested result";
      const leftover = leftoverWork(input.message, artifactEvidence(run));
      const why = haltAfterFail(review, run, extra.n, leftover);
      const note = haltNote(why, missing);
      run.append("system", note);
    }

    const corrected = review.operatorCorrected === true;
    const klass = failureClass({
      kind: review.failureKind,
      aborted: false,
    });
    const learned = lessonRule({
      taskClass: run.taskClass,
      goal: run.goal,
      latest: input.message,
      verdict: review.verdict,
      summary: review.summary,
      missing: review.missing,
      anchors: packed.anchors,
      operatorCorrected: corrected,
      failClass: klass,
      failedFamily: lessonTrail.failedFamily,
      recoveredBy: lessonTrail.recoveredBy,
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
      await this.graph.link(classKey(run.taskClass), learned.key, "learned");
      await this.growBodyFromRecovery(run, agent, failKlass.last, lessonTrail);
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
      await this.graph.link(classKey(klass), learned.key, "failed-as");
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
    lessonTrail = emptyTrail(),
  ): Promise<ChatResult> {
    const started = Date.now();
    const ws = this.workspaceFor(run.worktreePath);
    const tools = depth > 0 ? CHILD_TOOLS : AGENT_TOOLS;
    const userText = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const convo = [...messages];
    let last: ChatResult = { text: "", tokens: 0, usd: 0 };
    let tokens = 0;
    let usd = 0;
    let keepWritingN = 0;
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
      if (!last.toolCalls?.length) {
        const leftover = leftoverWork(run.goal, artifactEvidence(run));
        if (hasLeftover(leftover) && keepWritingN < 3) {
          keepWritingN += 1;
          convo.push({ role: "assistant", content: last.text || "(no tool call)" });
          convo.push({
            role: "user",
            content: keepWritingNudge(
              leftover.unwritten,
              extractToolEvidence(...run.transcript.filter((item) => item.kind === "console").map((item) => item.text)),
            ),
          });
          continue;
        }
        break;
      }
      convo.push({ role: "assistant", content: last.text, toolCalls: last.toolCalls });
      const packed = packSession(run.transcript, run.goal);
      const anchors = packed.anchors;
      const toolEvidence = extractToolEvidence(
        ...run.transcript.filter((item) => item.kind === "console").map((item) => item.text),
      );
      const leftoverNow = leftoverWork(run.goal, artifactEvidence(run));
      for (const rawCall of last.toolCalls) {
        const bound = bindToolArgs(rawCall.name, rawCall.arguments ?? {}, anchors);
        const call = {
          ...rawCall,
          arguments: bindFsWriteArgs(rawCall.name, bound, toolEvidence),
        };
        if (signal?.aborted) throw new DomainError("aborted", "step interrupted");
        const observeBase = {
          leftoverUnwritten: leftoverNow.unwritten,
          restorePaths: pathsWithRestore(run.id.value),
        };
        if (isFsMutate(call.name)) {
          await snapshotBeforeMutate(run.id.value, ws, String(call.arguments?.path ?? ""));
        }
        const preview = applyToolObserve(call, "", failedCalls, familyFails, observeBase);
        let raw = preview.skip ? preview.out : clipToolOut(await this.dispatchTool(run, ws, call, signal, depth), `${run.goal}\n${userText}`);
        if (!preview.skip && call.name === "shell") {
          raw = noteShellRun(run.id.value, call, raw);
        }
        if (!preview.skip && isFsMutate(call.name) && !/^error:/i.test(raw)) {
          raw = await withWriteCheckpoint(run.id.value, ws, call, raw);
          noteMutateSuccess(run.id.value, call);
        } else if (!preview.skip && call.name === "fs_edit" && classifyToolResult(raw, "fs_edit").error) {
          const editPath = String(call.arguments?.path ?? "");
          if (editPath) markFailedEdit(run.id.value, editPath);
        }
        const observeOpts = {
          ...observeBase,
          failedEditPaths: failedEditPaths(run.id.value),
          checkFailedPaths: checkFailedPaths(run.id.value),
        };
        const observed = preview.skip ? preview : applyToolObserve(call, raw, failedCalls, familyFails, observeOpts);
        const out = observed.out;
        const failed = observed.skip || /BLOCKED:/.test(out) || classifyToolResult(out, call.name).error;
        noteTrail(lessonTrail, familyKey(call), failed);
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
      const leftover = leftoverWork(run.goal, artifactEvidence(run));
      if (hasLeftover(leftover)) {
        last = {
          ...last,
          text: keepWritingNudge(
            leftover.unwritten,
            extractToolEvidence(...run.transcript.filter((item) => item.kind === "console").map((item) => item.text)),
          ),
          tokens,
          usd,
        };
      } else {
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
        toolEvidence: extractToolEvidence(
          ...run.transcript.filter((item) => item.kind === "console").map((item) => item.text),
        ),
        pageEvidence: pageEvidence(run.transcript, run.goal),
        goal: run.goal,
      }),
    };
  }

  private async closeFailureClass(
    run: Run,
    agent: Agent,
    review: { summary: string; missing?: string; aborted: boolean; failureKind?: FailureKind },
  ): Promise<void> {
    const klass = failureClass({
      kind: review.failureKind,
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
    await this.graph.link(classKey(klass), key, "failed-as");
  }

  private async growBodyFromRecovery(
    run: Run,
    agent: Agent,
    klass: string,
    lessonTrail: LessonTrail,
  ): Promise<string> {
    const recovered = Boolean(
      lessonTrail.failedFamily
      && lessonTrail.recoveredBy
      && lessonTrail.recoveredBy !== lessonTrail.failedFamily,
    );
    if (!klass || klass === "general" || klass === "aborted-unfinished") return "";
    const prev = parseBacklog((await this.memory.get(slugKey(`backlog/${klass}`)))?.body ?? "");
    if (!recovered && !prev) return "";
    const draft = learnedSkillDraft(klass, {
      failedFamily: lessonTrail.failedFamily,
      recoveredBy: lessonTrail.recoveredBy,
    });
    if (!draft || this.skills.get(draft.name)) return draft?.name ?? "";
    this.skills.writeFile(draft.name, "SKILL.md", draft.body);
    agent.evolve({ skills: [{ kind: "skill", name: draft.name, version: "1" }] });
    await this.agents.save(agent);
    await this.remember(run, agent.id.value, {
      key: `plugin/${draft.name}`,
      title: `Plugin ${draft.name}`,
      body: draft.body,
      tags: ["plugin", "learned", klass],
    });
    await this.graph.link(classKey(klass), pluginMemoryKey(draft.name), "learned");
    await this.graph.link(slugKey(`backlog/${klass}`), pluginMemoryKey(draft.name), "recovered-by");
    await this.become(`become: skill ${draft.name}`);
    return draft.name;
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
    extra: { n: number };
    psyche: PsycheState;
    lessonTrail: LessonTrail;
    failKlass: { last: string };
  }): Promise<{ act: ChatResult; review: Review }> {
    let { act, review } = input;
    rememberFailKlass(input.failKlass, review);
    const trail: ChatMessage[] = [{ role: "assistant", content: act.text }];
    while (true) {
      const leftover = leftoverWork(input.latest, artifactEvidence(input.run));
      const halt = haltAfterFail(review, input.run, input.extra.n, leftover, input.signal?.aborted);
      if (halt === "pass") return { act, review };
      if (halt === "abort") throw new DomainError("aborted", "step interrupted");
      if (halt !== "continue") {
        if (halt === "wanting") {
          const why = "wanting without liking: stop after extra path this message";
          input.psyche.board = addBoard(input.psyche.board, { kind: "decision", text: why });
          input.psyche.existence = appendExistence(input.psyche.existence, { kind: "act", text: why });
          await this.flushPsyche(input.run, input.run.agentId, input.psyche);
        }
        break;
      }

      let researchNote = "";
      const localFiles = missingIsLocalArtifact(review.missing, input.latest);
      if (input.run.status === "researching") {
        if (localFiles) {
          researchNote = "Local files are still missing. Write them with fs_write or shell; do not look up APIs.";
          this.events.publish(input.run.finishResearch(researchNote));
          researchNote = "";
        } else {
          const query = review.knowledgeQuery || review.missing || `${input.run.goal} ${input.latest}`;
          researchNote = await this.collectResearch(input.run, query, input.signal);
          this.events.publish(input.run.finishResearch(researchNote));
        }
      }

      const strategy = cycleStrategy(input.run.usedStrategies, input.run.attempts, localFiles);
      let learnedSkill = "";
      if (strategy === "write_capability") {
        const klass = failureClass({ kind: review.failureKind });
        const name = klass !== "general" && klass !== "aborted-unfinished" ? `learned-${klass}` : "";
        if (name && this.skills.get(name)) learnedSkill = name;
      }
      const why = `${strategy}: ${clipText(review.missing || review.summary || "unsolved", 100)} #${input.run.attempts + 1}`;
      input.psyche.board = addBoard(input.psyche.board, { kind: "decision", text: why });
      input.psyche.existence = appendExistence(input.psyche.existence, { kind: "act", text: why });
      await this.flushPsyche(input.run, input.run.agentId, input.psyche);
      try {
        this.events.publish(input.run.continueWith(strategy, why));
        input.extra.n += 1;
      } catch (err) {
        if (err instanceof DomainError) {
          input.run.append("system", err.message);
          break;
        }
        throw err;
      }

      if (strategy === "research" && !researchNote && !localFiles) {
        const query = review.knowledgeQuery || review.missing || `${input.run.goal} ${input.latest}`;
        researchNote = await this.collectResearch(input.run, query, input.signal);
        input.run.append("research", researchNote);
      }

      trail.push({ role: "user", content: persistNudge(strategy, review, researchNote, input.run.goal, input.latest, artifactEvidence(input.run), learnedSkill) });
      const next = this.sealAct(input.run, await this.verifyAgainstEvidence(
        input.run,
        await this.actWithTools(input.run, [...input.actMessages, ...trail], input.signal, input.depth, input.failedCalls, input.psyche, input.familyFails, input.lessonTrail),
        input.signal,
      ), input.latest);
      this.commitAct(input.run, next);
      trail.push({ role: "assistant", content: next.text });
      if (trail.length > 8) trail.splice(0, trail.length - 8);
      act = next;
      review = await this.reviewLatest(input.run, input.latest, next.text, input.signal);
      rememberFailKlass(input.failKlass, review);
    }
    return { act, review };
  }

  private async reviewLatest(run: Run, latest: string, actText: string, signal?: AbortSignal): Promise<Review> {
    const raw = await this.completeRole(run, "reviewer", [
      { role: "system", content: REVIEWER_SYSTEM },
      { role: "user", content: reviewPacket(run.goal, latest, actText, reviewEvidence(run, latest)) },
    ], { signal });
    const review = judgeReview(raw.text, latest, artifactEvidence(run), actText, reviewOpts(run.id.value));
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
    if (call.name === "fs_restore") {
      return restoreFile(run.id.value, ws, String(call.arguments?.path ?? ""));
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
    if (!pages.trim() && requestedArtifacts(run.goal).length) return act;
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
    const steps = route.plan.length ? `${route.plan.length} steps` : "heuristic plan";
    const research = route.needResearch ? ", research" : "";
    const analysis = route.analysis ? ` — ${clipText(route.analysis, 160)}` : "";
    run.append("thinking", `topic: ${route.topic || "—"} → ${route.short ? "short chat" : steps}${research}${analysis}`);
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
          turnLawFromConstitution(agent.constitution),
          renderSamostPrompt(psyche.samost, message),
          `Session goal: ${run.goal}`,
          workspaceLines(run.worktreePath, run.sessionPath),
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

function rememberFailKlass(bag: { last: string }, review: { verdict?: string; failureKind?: FailureKind; aborted?: boolean }): void {
  if (review.verdict === "pass") return;
  const klass = failureClass({
    kind: review.failureKind,
    aborted: review.aborted,
  });
  if (klass !== "general" && klass !== "aborted-unfinished") bag.last = klass;
}

function haltAfterFail(
  review: Review,
  run: Run,
  extraApproaches: number,
  leftover?: { unwritten: string[] },
  aborted?: boolean,
): HaltReason {
  return stopAfterFail(review, {
    aborted,
    exhausted: run.budget.exhausted(),
    attempts: run.attempts,
    maxAttempts: run.maxAttempts,
    minStrategies: run.minStrategies,
    used: run.usedStrategies.length,
    wanting: wantingWithoutLiking({ extraApproaches, leftover }),
  });
}

function haltNote(why: HaltReason, missing: string): string {
  if (why === "need_user") {
    return `Need a decision or secret: ${clipText(missing, 240)}. I cannot continue without it.`;
  }
  if (why === "wanting") {
    return `Wanting without liking: stopped after one extra path this message. Still missing: ${clipText(missing, 240)}. Next message continues from here.`;
  }
  return `Still missing: ${clipText(missing, 240)} (${why === "continue" ? "last approach could not start" : why}). Next message continues from here.`;
}

const SHORT_CHAT_RULES = `Short turn. No tools, no search, no review loop.
The instance name is Barney. It is a dedication, not a role. On who-are-you: one or two sentences — local agent Barney; the name was given, not inferred. Do not invent a biography.
Do not invent world facts without a tool. If a tool is required — first line exactly NEED_TOOLS, no prose.
Keep thinking short. The visible reply is the result, not a plan.`;

function isPsycheKey(key: string): boolean {
  return key.startsWith("samost/") || key.startsWith("existence/") || key.startsWith("tree/") || key.startsWith("session/") || key.startsWith("design/");
}

const RECOVERY_NUDGE = `No tool ran. Do the user's requested work now with real tool calls.
If they asked for a file, fs_write the full markdown into the worktree.
Do not output <action> tags. Do not only spawn. Do not describe the plan — execute it.`;

function leftoverWork(goal: string, evidence: string): { unwritten: string[] } {
  return { unwritten: unwrittenArtifacts(goal, evidence) };
}

function hasLeftover(work: { unwritten: string[] }): boolean {
  return work.unwritten.length > 0;
}

function keepWritingNudge(unwritten: string[], evidence: string[] = []): string {
  const bits: string[] = [];
  if (unwritten.length) {
    bits.push(`Still missing on disk: ${unwritten.join(", ")}. Write only those files. If a prior redirect captured a tool error, overwrite with successful output. After writing, validate yourself (syntax/run as fits the file); if broken, fix or fs_restore. Copy live values from tool output. Do not invent DETECTED_SECRET tokens.`);
  }
  if (evidence.length) {
    bits.push(`Pinned tool lines (copy exactly into the files):\n${evidence.map((line) => `- ${line}`).join("\n")}`);
  }
  bits.push("Tools are allowed.");
  return bits.join(" ");
}

const REVIEWER_SYSTEM = `Role: reviewer. Decide only whether the agent delivered the result the user asked for. This is a judgment of the act, not a personality.

Pass only if the latest user request is actually satisfied — the concrete outcome they wanted.
Do not pass a workaround, approximation, plan-without-result, partial progress, identification-without-action, or "I used what was available".
If the user asked for a specific action or fact, that exact result must be present in tool/console evidence — not only in the agent's prose.

Trust console evidence over the agent's summary. Read exit codes and stdout/stderr yourself — do not assume a path existing means the content is correct.
Existence of a path is not enough: judge whether the file contents match what was asked. Tool-error dumps redirected into a deliverable are not a pass.
If the evidence includes a pin line "Not yet written:" or "Last write captured a tool error", verdict MUST be fail and missing MUST list those paths.
Every path the user asked to create/write/save must appear in write or listing evidence with successful content. Naming a helper file instead of the requested path is not a pass.
Fail when the user asked to apply a change and evidence only shows inspection (looked up, listed, showed) without actually applying it.
Fail when tool evidence still shows unresolved conflict markers (<<<<<<< / ======= / >>>>>>>) in a deliverable.
Fail when a deliverable was exercised and failed (non-zero exit) with no later successful exit 0 — the agent's claim that it works is not enough.
Fail when a syntax/config check in evidence reported failure even if a shell wrapper exited 0 via || echo — the check itself failed.
Fail when the user asked for specific fields or facts in a file and evidence shows those fields missing — a helper script that passed is not enough.
Fail when evidence pins say "Check failed on:" — those paths are broken until fixed or restored.
Fail when the user asked to read/open a concrete URL and evidence has no browser_open (or opened) of that same URL — another page on the same host is not enough.
Fail when reviewer JSON is truncated: do not pass without an explicit achieved:true in a complete object.
Fail when the visible reply is mostly thinking narration about what the user asked instead of the answer itself.
Fail when the agent left the job unfinished: some requested files present, others absent.

Fail when:
- the agent substituted a different result than asked
- the answer is incomplete, evasive, or answers a different question
- tools were available and the request required them, but they were not used
- the agent only described what it would do or only located the change without applying it
- the agent truncated, guessed, or altered a fact that was already in tool or research evidence

DETECTED_SECRET_<KIND>_<HASH> in tool output is a guard mask of a live secret still on disk — not a replacement the agent made. If the user asked for placeholders such as <your-aws-access-key-id>, those exact strings must appear as writes; the mask tokens are evidence the secret is still present.
Fail when a newly written deliverable contains DETECTED_SECRET_* and the user asked for a live computed value. The mask is not that value.
Fail when a requested file was written by a redirect with a non-zero exit, or its contents are clearly tool failure output. Existence of that file is not a pass — overwrite it from successful output.
If evidence lists files already on disk with good content, do not claim they are missing. Fail only for what is still absent or wrong.
Fail when the latest user message says the previous answer was wrong — set operatorCorrected true.
Use uncertain / gap / unknown_api when the task needs vendor docs, the web, or an API the agent has not looked up yet. Set needsResearch true in that case.
Set needsUser true when the agent cannot continue without a secret or choice from the user.
When verdict is fail, set failureKind: masked-deliverable | unrun-program | captured-error | missing-artifact | general.
JSON only. No chain-of-thought.

Reply as JSON only:
{"verdict":"pass|fail|uncertain|unknown_api|gap","achieved":true|false,"requested":"what the user wanted","missing":"what is still missing or empty","summary":"...","needsResearch":true|false,"needsUser":true|false,"operatorCorrected":true|false,"failureKind":"general|masked-deliverable|unrun-program|captured-error|missing-artifact","knowledgeQuery":"..."}`;

function reviewPacket(goal: string, latest: string, act: string, evidence: string): string {
  return [
    `Session goal: ${goal}`,
    `Latest user request (this is what must be satisfied): ${latest}`,
    `Agent reply:\n${act.slice(0, 4000)}`,
    `Tool / console evidence (pins, exit codes, and console win over the agent reply):\n${evidence || "(none)"}`,
    "Did the agent achieve the result the user asked for? Interpret errors and file contents yourself. If pins say Not yet written, Check failed on, or a write exited non-zero, or a config/syntax check failed in evidence, or a deliverable is missing asked fields, or a required URL was never opened, or evidence only inspected without applying an asked change, verdict must be fail.",
  ].filter(Boolean).join("\n\n");
}

function clipToolOut(out: string, query: string): string {
  const html = /<html|<!doctype|SVELTE_HYDRATER|<\/div>/i.test(out);
  const limit = html ? 2200 : 4000;
  const sliced = clipPage(out, query, limit);
  return html ? `${sliced}\n[raw HTML — extract facts only, do not dump markup to the user]` : sliced;
}

function artifactEvidence(run: { transcript: Array<{ kind: string; text: string }> }): string {
  return run.transcript
    .filter((item) => item.kind === "console")
    .map((item) => item.text)
    .join("\n");
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
  if (!/\.md\b|\bmarkdown\b|\bmd\b/i.test(message)) return null;
  const named = message.match(/([\w./-]+\.md)\b/i);
  if (named?.[1]) return named[1].replace(/^\.?\//, "");
  return "notes.md";
}

function reviewOpts(runId: string): { unverifiedPaths: string[] } {
  return { unverifiedPaths: unverifiedPaths(runId) };
}

function reviewEvidence(
  run: { id: { value: string }; goal?: string; transcript: Array<{ kind: string; text: string }> },
  latest: string,
): string {
  const pins = artifactPins(latest, artifactEvidence(run));
  const validation = validationPinLine(run.id.value, requestedArtifacts(latest));
  const recent = recentEvidence(run);
  return [pins, validation, recent].filter(Boolean).join("\n---\n");
}

function persistNudge(strategy: StrategyName, review: Review, researchNote: string, goal: string, latest: string, evidence: string, learnedSkill = ""): string {
  const missing = stillMissingArtifacts(latest, evidence, review.missing || review.summary);
  const pins = artifactPins(latest, evidence);
  const research = researchNote ? `\nResearch notes:\n${researchNote}` : "";
  const keep = pins ? `\n${pins}` : "";
  const common = `Session goal: ${goal}${keep}\nStill missing: ${missing}\nDo not give up. Copy URLs/IPs from Session facts exactly. Do not ask the user to repeat them.${research}`;
  if (strategy === "research") {
    return `${common}\nLook up the vendor API/docs, then execute with tools.`;
  }
  if (strategy === "decompose") {
    return `${common}\nCreate only what is still missing. One clean shell or fs_* call per file. Do not put plans in the command string. Do not regenerate files already on disk.`;
  }
  if (strategy === "write_capability") {
    const body = learnedSkill
      ? `\nA scheme for this miss is in plugin ${learnedSkill}. plugin_read it, then deliver the result this turn.`
      : `\nChange tool family. Do not invent a plugin from this miss. Still deliver the result this turn.`;
    return `${common}${body}`;
  }
  if (strategy === "switch_model") {
    return `${common}\nChange approach completely (browser vs shell vs API vs plugin). Do not repeat the failed guess.`;
  }
  return `${common}\nKeep files that already exist. Only create what is still missing. Follow the working plan in order.`;
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

const FS_MUTATE = new Set(["fs_write", "fs_edit", "fs_append"]);

function isFsMutate(name: string): boolean {
  return FS_MUTATE.has(name);
}

async function snapshotBeforeMutate(runId: string, ws: WorkspacePort, path: string): Promise<void> {
  if (!path.trim()) return;
  try {
    const body = await ws.read(path);
    if (body.startsWith("error:") || body.startsWith("directory:") || body.startsWith("binary ") || body.startsWith("file too large")) return;
    rememberPrevious(runId, path, body);
  } catch {
    /* new file */
  }
}

async function withWriteCheckpoint(
  runId: string,
  ws: WorkspacePort,
  call: ToolCall,
  raw: string,
): Promise<string> {
  const path = String(call.arguments?.path ?? "");
  if (!path) return raw;
  const prior = restoreBody(runId, path);
  const body = await bodyAfterMutate(ws, call);
  if (body != null) rememberGood(runId, path, body);
  const canUndo = Boolean(prior && body != null && prior.content !== body);
  const restore = canUndo
    ? ` If a later check fails, fs_restore ${path} brings back the previous session version.`
    : "";
  const regression = wasPassedRun(runId, path)
    ? " This file had a passing run earlier — avoid truncating or rewriting the whole file; fix minimally or fs_restore if broken."
    : "";
  return attachObserve(
    raw,
    `Validate this file yourself before claiming done — look up how to syntax-check or run it for this format, then do that via shell.${restore}${regression}`,
  );
}

function noteShellRun(runId: string, call: ToolCall, raw: string): string {
  const command = String(call.arguments?.command ?? "");
  const code = shellExitCode(raw);
  const redirects = redirectTargetsInCommand(command);
  for (const path of redirects) trackMutated(runId, path);

  if (code != null && code !== 0) {
    const abs = absoluteFilePathsInCommand(command);
    for (const path of abs) trackMutated(runId, path);
    const touched = [...new Set([...trackedPathsInCommand(runId, command), ...redirects, ...abs])];
    for (const path of touched) markCheckFailed(runId, path);
    const failed = checkFailedPaths(runId);
    if (!touched.length && !failed.length && !unverifiedPaths(runId).length) return raw;
    const names = (touched.length ? touched : failed).slice(0, 4).join(", ");
    const where = names ? ` on ${names}` : "";
    return attachObserve(
      raw,
      `Check failed${where} — fix minimally or fs_restore; do not chain more patches on the same broken file.`,
    );
  }

  if (code !== 0) return raw;
  for (const path of redirects) markUnverified(runId, path);
  const touched = trackedPathsInCommand(runId, command);
  if (!touched.length) return raw;
  const stdout = shellStdout(raw);
  if (runOutputLooksIncomplete(stdout)) {
    for (const path of touched) markUnverified(runId, path);
    return attachObserve(
      raw,
      "Run exited 0 with no output on a file you wrote — fix it or fs_restore; do not replace the whole file with a shorter version.",
    );
  }
  for (const path of touched) markPassedRun(runId, path);
  return raw;
}

function noteMutateSuccess(runId: string, call: ToolCall): void {
  const path = String(call.arguments?.path ?? "");
  if (!path) return;
  trackMutated(runId, path);
  markUnverified(runId, path);
  if (call.name === "fs_edit") clearFailedEdit(runId, path);
}

async function bodyAfterMutate(ws: WorkspacePort, call: ToolCall): Promise<string | undefined> {
  if (call.name === "fs_write") {
    const content = call.arguments?.content;
    return typeof content === "string" ? content : undefined;
  }
  const path = String(call.arguments?.path ?? "");
  try {
    const body = await ws.read(path);
    if (body.startsWith("error:") || body.startsWith("directory:") || body.startsWith("binary ")) return;
    return body;
  } catch {
    return;
  }
}

async function restoreFile(runId: string, ws: WorkspacePort, path: string): Promise<string> {
  if (!path.trim()) return "error: path is required";
  const hit = restoreBody(runId, path);
  if (!hit) return `error: no checkpoint for ${path} in this session`;
  try {
    const out = await ws.write(path, hit.content);
    rememberGood(runId, path, hit.content);
    trackMutated(runId, path);
    markUnverified(runId, path);
    return attachObserve(`${out} (restored ${hit.source})`, "Validate the restored file yourself before claiming done.");
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
