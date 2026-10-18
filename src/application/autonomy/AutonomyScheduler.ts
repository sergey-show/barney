/**
 * Cooldown clock for Kernel idle / agenda / dream / study ticks.
 * Extracted so Kernel stays a composition root, not a timer bag.
 */

export type AutonomyClocks = {
  idleAt: number;
  studyAt: number;
  selfRunAt: number;
  plasticSleepAt: number;
  innerThinkAt: number;
};

export type AutonomyAction =
  | "idle"
  | "study"
  | "self_run"
  | "plastic_sleep"
  | "inner_think";

const DEFAULT_IDLE_GAP_MS = 45_000;

export class AutonomyScheduler {
  private clocks: AutonomyClocks;

  constructor(
    clocks?: Partial<AutonomyClocks>,
    private readonly idleGapMs = DEFAULT_IDLE_GAP_MS,
  ) {
    this.clocks = {
      idleAt: clocks?.idleAt ?? 0,
      studyAt: clocks?.studyAt ?? 0,
      selfRunAt: clocks?.selfRunAt ?? 0,
      plasticSleepAt: clocks?.plasticSleepAt ?? 0,
      innerThinkAt: clocks?.innerThinkAt ?? 0,
    };
  }

  snapshot(): AutonomyClocks {
    return { ...this.clocks };
  }

  /** Returns false when idle tick should skip (too soon). */
  tryBeginIdle(now = Date.now()): boolean {
    if (now - this.clocks.idleAt < this.idleGapMs) return false;
    this.clocks.idleAt = now;
    return true;
  }

  mark(action: Exclude<AutonomyAction, "idle">, now = Date.now()): void {
    if (action === "study") this.clocks.studyAt = now;
    else if (action === "self_run") this.clocks.selfRunAt = now;
    else if (action === "plastic_sleep") this.clocks.plasticSleepAt = now;
    else if (action === "inner_think") this.clocks.innerThinkAt = now;
  }

  cooldownMs(action: AutonomyAction, now = Date.now()): number {
    const at =
      action === "idle" ? this.clocks.idleAt
      : action === "study" ? this.clocks.studyAt
      : action === "self_run" ? this.clocks.selfRunAt
      : action === "plastic_sleep" ? this.clocks.plasticSleepAt
      : this.clocks.innerThinkAt;
    return now - at;
  }
}
