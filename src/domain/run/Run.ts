import type { Agent } from "../agent/Agent.ts";
import { event, type DomainEvent } from "../shared/DomainEvent.ts";
import { DomainError, InvariantError } from "../shared/DomainError.ts";
import { Budget } from "./Budget.ts";
import { reviewNeedsResearch, type Review } from "./Review.ts";
import { RunId } from "./RunId.ts";
import type { ReplyMeta } from "./replyMeta.ts";
import { planHash, type StrategyName } from "./Strategy.ts";

export type { ReplyMeta } from "./replyMeta.ts";

export type RunStatus =
  | "ready"
  | "acting"
  | "reviewing"
  | "researching"
  | "parked"
  | "done"
  | "failed";

export type TranscriptItem = {
  id: string;
  kind: "user" | "thinking" | "assistant" | "console" | "review" | "research" | "system" | "secret";
  text: string;
  at: string;
  meta?: ReplyMeta;
};

export type RunSnapshot = {
  id: string;
  agentId: string;
  goal: string;
  taskClass: string;
  status: RunStatus;
  worktreePath: string;
  attempts: number;
  usedStrategies: string[];
  failedPlanHashes: string[];
  lastPlanHash: string | null;
  lastFailureMode: string | null;
  sameFailureCount: number;
  distinctStrategies: number;
  transcript: TranscriptItem[];
  tokensUsed: number;
  usdUsed: number;
};

export class Run {
  readonly id: RunId;
  readonly agentId: string;
  readonly goal: string;
  readonly taskClass: string;
  readonly worktreePath: string;
  readonly budget: Budget;
  readonly reviewRequired: boolean;
  readonly minStrategies: number;
  readonly maxAttempts: number;
  readonly maxSameFailure: number;

  status: RunStatus = "ready";
  attempts = 0;
  usedStrategies: StrategyName[] = [];
  failedPlanHashes: string[] = [];
  lastPlanHash: string | null = null;
  lastFailureMode: string | null = null;
  sameFailureCount = 0;
  transcript: TranscriptItem[] = [];
  pendingReview = false;

  private constructor(props: {
    id: RunId;
    agentId: string;
    goal: string;
    taskClass: string;
    worktreePath: string;
    budget: Budget;
    reviewRequired: boolean;
    minStrategies: number;
    maxAttempts: number;
    maxSameFailure: number;
  }) {
    this.id = props.id;
    this.agentId = props.agentId;
    this.goal = props.goal;
    this.taskClass = props.taskClass;
    this.worktreePath = props.worktreePath;
    this.budget = props.budget;
    this.reviewRequired = props.reviewRequired;
    this.minStrategies = props.minStrategies;
    this.maxAttempts = props.maxAttempts;
    this.maxSameFailure = props.maxSameFailure;
  }

  static start(agent: Agent, input: { goal: string; worktreePath: string; taskClass?: string; id?: RunId }): Run {
    if (!input.goal.trim()) throw new InvariantError("run goal is required");
    const policy = agent.solvePolicy;
    const run = new Run({
      id: input.id ?? RunId.create(),
      agentId: agent.id.value,
      goal: input.goal.trim(),
      taskClass: input.taskClass ?? agent.taskClass,
      worktreePath: input.worktreePath,
      budget: new Budget(policy.budgetTokens, policy.budgetUsd, policy.budgetMs),
      reviewRequired: policy.reviewRequired,
      minStrategies: policy.minStrategies,
      maxAttempts: policy.maxAttempts,
      maxSameFailure: policy.maxSameFailure,
    });
    run.append("system", `Run started for agent ${agent.name}`);
    return run;
  }

  append(kind: TranscriptItem["kind"], text: string, meta?: ReplyMeta): TranscriptItem {
    const item: TranscriptItem = {
      id: crypto.randomUUID(),
      kind,
      text,
      at: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    };
    this.transcript.push(item);
    return item;
  }

  beginAct(strategy: StrategyName, detail: string): DomainEvent[] {
    this.assertOpen();
    if (this.budget.exhausted()) {
      this.append("system", "Budget exhausted; session stays open.");
    }
    if (this.reviewRequired && this.pendingReview) {
      throw new DomainError("review_required", "cannot act again before review");
    }
    const hash = planHash(strategy, detail);
    if (this.failedPlanHashes.includes(hash)) {
      throw new DomainError("repeat_plan", "same plan_hash already failed");
    }
    if (this.attempts >= this.maxAttempts) {
      this.append("system", "Attempt cap reached; session stays open.");
    }
    this.status = "acting";
    this.attempts += 1;
    this.lastPlanHash = hash;
    if (!this.usedStrategies.includes(strategy)) this.usedStrategies.push(strategy);
    this.pendingReview = this.reviewRequired;
    this.append("system", `act:${strategy} ${detail}`);
    return [event("run.act_started", { runId: this.id.value, strategy, detail })];
  }

  finishAct(output: string, tokens: number, usd: number, meta?: ReplyMeta): DomainEvent[] {
    if (this.status !== "acting") throw new DomainError("invalid_state", "not acting");
    this.budget.charge(tokens, usd);
    this.append("assistant", output, meta);
    this.status = this.reviewRequired ? "reviewing" : "ready";
    return [event("run.act_finished", { runId: this.id.value })];
  }

  submitReview(review: Review): DomainEvent[] {
    if (this.status !== "reviewing" && this.reviewRequired) {
      throw new DomainError("invalid_state", "not reviewing");
    }
    this.pendingReview = false;
    this.append("review", `${review.verdict}: ${review.summary}`);
    if (review.verdict === "pass") {
      this.status = "ready";
      this.append("system", "Review passed. Session stays open.");
      return [event("run.reviewed", { runId: this.id.value, verdict: "pass" })];
    }
    this.recordFailure(review.verdict);
    if (reviewNeedsResearch(review)) {
      this.status = "researching";
      return [event("run.research_required", { runId: this.id.value, query: review.knowledgeQuery ?? review.summary })];
    }
    this.status = "ready";
    return [event("run.review_failed", { runId: this.id.value, verdict: review.verdict })];
  }

  finishResearch(note: string): DomainEvent[] {
    if (this.status !== "researching") throw new DomainError("invalid_state", "not researching");
    this.append("research", note);
    this.status = "ready";
    return [event("run.research_finished", { runId: this.id.value })];
  }

  continueWith(strategy: StrategyName, whyDifferent: string): DomainEvent[] {
    if (!whyDifferent.trim()) throw new DomainError("repeat_plan", "continue requires why_different");
    if (this.budget.exhausted()) {
      this.append("system", "Budget exhausted; session stays open.");
    }
    if (this.sameFailureCount >= this.maxSameFailure && strategy === this.usedStrategies.at(-1)) {
      throw new DomainError("same_failure", "same failure_mode exhausted for this strategy");
    }
    return this.beginAct(strategy, whyDifferent);
  }

  interrupt(reason = "Step interrupted."): DomainEvent[] {
    if (this.status === "done" || this.status === "parked" || this.status === "failed") {
      throw new DomainError("run_closed", `run is ${this.status}`);
    }
    this.status = "ready";
    this.pendingReview = false;
    this.append("system", reason.trim() || "Step interrupted.");
    return [event("run.interrupted", { runId: this.id.value })];
  }

  close(): DomainEvent[] {
    this.assertOpen();
    this.status = "done";
    this.append("system", "Session closed.");
    return [event("run.completed", { runId: this.id.value })];
  }

  park(reason: string): DomainEvent[] {
    this.status = "parked";
    this.append("system", `Parked: ${reason}`);
    return [event("run.parked", { runId: this.id.value, reason })];
  }

  canEscalate(): boolean {
    return this.usedStrategies.length >= this.minStrategies || this.budget.exhausted();
  }

  private recordFailure(mode: string): void {
    if (this.lastPlanHash) this.failedPlanHashes.push(this.lastPlanHash);
    if (this.lastFailureMode === mode) this.sameFailureCount += 1;
    else {
      this.lastFailureMode = mode;
      this.sameFailureCount = 1;
    }
  }

  private assertOpen(): void {
    if (this.status === "done" || this.status === "parked" || this.status === "failed") {
      throw new DomainError("run_closed", `run is ${this.status}`);
    }
  }

  snapshot(): RunSnapshot {
    return {
      id: this.id.value,
      agentId: this.agentId,
      goal: this.goal,
      taskClass: this.taskClass,
      status: this.status,
      worktreePath: this.worktreePath,
      attempts: this.attempts,
      usedStrategies: [...this.usedStrategies],
      failedPlanHashes: [...this.failedPlanHashes],
      lastPlanHash: this.lastPlanHash,
      lastFailureMode: this.lastFailureMode,
      sameFailureCount: this.sameFailureCount,
      distinctStrategies: this.usedStrategies.length,
      transcript: this.transcript.map((t) => ({ ...t })),
      tokensUsed: this.budget.tokensUsed,
      usdUsed: this.budget.usdUsed,
    };
  }

  static rehydrate(snap: RunSnapshot, agent: Agent): Run {
    const run = new Run({
      id: RunId.create(snap.id),
      agentId: snap.agentId,
      goal: snap.goal,
      taskClass: snap.taskClass,
      worktreePath: snap.worktreePath,
      budget: new Budget(agent.solvePolicy.budgetTokens, agent.solvePolicy.budgetUsd, agent.solvePolicy.budgetMs),
      reviewRequired: agent.solvePolicy.reviewRequired,
      minStrategies: agent.solvePolicy.minStrategies,
      maxAttempts: agent.solvePolicy.maxAttempts,
      maxSameFailure: agent.solvePolicy.maxSameFailure,
    });
    run.status = snap.status;
    run.attempts = snap.attempts;
    run.usedStrategies = snap.usedStrategies as StrategyName[];
    run.failedPlanHashes = snap.failedPlanHashes;
    run.lastPlanHash = snap.lastPlanHash;
    run.lastFailureMode = snap.lastFailureMode;
    run.sameFailureCount = snap.sameFailureCount;
    run.transcript = snap.transcript;
    run.budget.tokensUsed = snap.tokensUsed;
    run.budget.usdUsed = snap.usdUsed;
    run.pendingReview = snap.status === "reviewing";
    return run;
  }
}
