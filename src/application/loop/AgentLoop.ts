/**
 * AgentLoop: act → tools → review → oracle → persistUntilDone.
 * DriveSolve keeps the outer cognitive loop (review → oracle → persistUntilDone).
 * AgentLoop owns: maxSteps, doom detection, keep-writing nudges, part events.
 */

import type { ToolCall } from "../../domain/tools/FileTools.ts";
import { toolSignature } from "../context/observeTool.ts";

export type AgentLoopMode = "normal" | "keep_writing" | "final";

export type AgentLoopConfig = {
  maxSteps: number;
  /** Extra rounds when leftover artifacts remain but model stopped calling tools. */
  maxKeepWriting: number;
  /** Identical failed tool signatures before doom halt. */
  doomRepeat: number;
  /**
   * Model must answer without more tool calls.
   */
  stripToolsOnLastStep: boolean;
};

export const DEFAULT_AGENT_LOOP: AgentLoopConfig = {
  maxSteps: 12,
  maxKeepWriting: 3,
  doomRepeat: 3,
  stripToolsOnLastStep: true,
};

/** Last step index (0-based) when tools should be stripped. */
export function isFinalToolStep(step: number, config: AgentLoopConfig): boolean {
  return config.stripToolsOnLastStep && step >= config.maxSteps - 1;
}

export type LoopHalt =
  | "done"
  | "max_steps"
  | "aborted"
  | "doom_loop"
  | "empty";

export type AgentLoopPart =
  | { kind: "step_start"; step: number }
  | { kind: "tool_started"; step: number; tool: string; callId: string; signature: string }
  | { kind: "tool_result"; step: number; tool: string; callId: string; ok: boolean }
  | { kind: "step_end"; step: number; halt?: LoopHalt; reason?: string };

export type AgentLoopHooks = {
  onPart?: (part: AgentLoopPart) => void;
  isAborted?: () => boolean;
};

export type ActRound = {
  text: string;
  toolCalls?: ToolCall[];
  tokens: number;
  usd: number;
};

export type AgentLoopResult<T extends ActRound> = {
  act: T;
  steps: number;
  keepWriting: number;
  halt: LoopHalt;
  reason?: string;
};

/**
 * Pure policy: should we stop the tool loop after this round?
 */
export function decideAfterRound(input: {
  step: number;
  config: AgentLoopConfig;
  hasToolCalls: boolean;
  keepWriting: number;
  hasLeftover: boolean;
  doom: boolean;
  aborted: boolean;
}): { action: "stop" | "continue" | "keep_writing"; halt?: LoopHalt; reason?: string } {
  if (input.aborted) return { action: "stop", halt: "aborted", reason: "signal aborted" };
  if (input.doom) return { action: "stop", halt: "doom_loop", reason: "repeated identical tool failures" };
  if (input.step + 1 >= input.config.maxSteps && input.hasToolCalls) {
    return { action: "stop", halt: "max_steps", reason: `hit maxSteps=${input.config.maxSteps}` };
  }
  if (!input.hasToolCalls) {
    if (input.hasLeftover && input.keepWriting < input.config.maxKeepWriting) {
      return { action: "keep_writing" };
    }
    return { action: "stop", halt: "done" };
  }
  return { action: "continue" };
}

export class DoomTracker {
  private readonly counts = new Map<string, number>();

  constructor(private readonly threshold: number) {}

  noteFailure(call: Pick<ToolCall, "name" | "arguments">): boolean {
    const sig = toolSignature(call);
    const n = (this.counts.get(sig) ?? 0) + 1;
    this.counts.set(sig, n);
    return n >= this.threshold;
  }

  noteSuccess(call: Pick<ToolCall, "name" | "arguments">): void {
    this.counts.delete(toolSignature(call));
  }

  /** How many times this signature has failed in this act. */
  count(call: Pick<ToolCall, "name" | "arguments">): number {
    return this.counts.get(toolSignature(call)) ?? 0;
  }
}

/**
 * Run the inner act↔tools loop via callbacks.
 * DriveSolve supplies complete/execute; AgentLoop owns step accounting.
 */
export async function runAgentToolLoop<T extends ActRound>(input: {
  config?: Partial<AgentLoopConfig>;
  hooks?: AgentLoopHooks;
  /** Initial empty act if first complete fails oddly. */
  seed: T;
  complete: (step: number, mode: AgentLoopMode) => Promise<T>;
  hasLeftover: () => boolean;
  /** Execute tools for this act; return whether doom triggered. */
  executeTools: (act: T, step: number, doom: DoomTracker) => Promise<{ doom: boolean }>;
}): Promise<AgentLoopResult<T>> {
  const config: AgentLoopConfig = { ...DEFAULT_AGENT_LOOP, ...input.config };
  const doom = new DoomTracker(config.doomRepeat);
  const emit = (part: AgentLoopPart) => input.hooks?.onPart?.(part);
  let act = input.seed;
  let keepWriting = 0;
  let steps = 0;

  for (let step = 0; step < config.maxSteps; step++) {
    if (input.hooks?.isAborted?.()) {
      return { act, steps, keepWriting, halt: "aborted", reason: "signal aborted" };
    }
    emit({ kind: "step_start", step });
    const mode: AgentLoopMode = isFinalToolStep(step, config)
      ? "final"
      : keepWriting > 0 && !act.toolCalls?.length
        ? "keep_writing"
        : "normal";
    act = await input.complete(step, mode);
    steps = step + 1;

    // Last step: ignore tool calls even if the model still emits them.
    if (mode === "final") {
      if (act.toolCalls?.length) {
        act = { ...act, toolCalls: undefined };
      }
      emit({ kind: "step_end", step, halt: "done", reason: "final step (tools stripped)" });
      return { act, steps, keepWriting, halt: "done", reason: "final step (tools stripped)" };
    }

    const hasTools = Boolean(act.toolCalls?.length);
    if (hasTools) {
      const exec = await input.executeTools(act, step, doom);
      const decision = decideAfterRound({
        step,
        config,
        hasToolCalls: true,
        keepWriting,
        hasLeftover: input.hasLeftover(),
        doom: exec.doom,
        aborted: Boolean(input.hooks?.isAborted?.()),
      });
      if (decision.action === "stop") {
        emit({ kind: "step_end", step, halt: decision.halt, reason: decision.reason });
        return { act, steps, keepWriting, halt: decision.halt ?? "done", reason: decision.reason };
      }
      emit({ kind: "step_end", step });
      continue;
    }

    const decision = decideAfterRound({
      step,
      config,
      hasToolCalls: false,
      keepWriting,
      hasLeftover: input.hasLeftover(),
      doom: false,
      aborted: Boolean(input.hooks?.isAborted?.()),
    });
    if (decision.action === "keep_writing") {
      keepWriting += 1;
      emit({ kind: "step_end", step, reason: "keep_writing" });
      continue;
    }
    emit({ kind: "step_end", step, halt: decision.halt ?? "done", reason: decision.reason });
    return { act, steps, keepWriting, halt: decision.halt ?? "done", reason: decision.reason };
  }

  return { act, steps, keepWriting, halt: "max_steps", reason: `hit maxSteps=${config.maxSteps}` };
}

export function partToEventType(part: AgentLoopPart): string {
  if (part.kind === "tool_started") return "run.tool_started";
  if (part.kind === "tool_result") return "run.tool_result";
  if (part.kind === "step_start") return "run.loop_step";
  return "run.loop_step_end";
}
