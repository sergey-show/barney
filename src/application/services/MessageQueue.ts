/**
 * Mid-run steer / post-settle follow-up queues.
 * Start vs steer are orthogonal: steer never invents a run; empty steer is rejected.
 */

export type QueueMode = "one-at-a-time" | "all";

export type SteerSource = "operator" | "workspace_delta" | "wake" | "mail" | "system";

export type SteerItem = {
  text: string;
  source: SteerSource;
  at: number;
};

export type EnqueueResult =
  | { ok: true; depth: number }
  | { ok: false; reason: "empty" | "cap" | "invalid_source" };

const DEFAULT_CAP = 32;

export class MessageQueue {
  private readonly steer = new Map<string, SteerItem[]>();
  private readonly followUp = new Map<string, string[]>();
  private readonly caps = new Map<string, number>();

  setCap(runId: string, cap: number): void {
    this.caps.set(runId, Math.max(1, cap));
  }

  enqueueSteer(runId: string, text: string, source: SteerSource = "operator"): EnqueueResult {
    const t = text.trim();
    if (!t) return { ok: false, reason: "empty" };
    if (!runId.trim()) return { ok: false, reason: "empty" };
    const list = this.steer.get(runId) ?? [];
    const cap = this.caps.get(runId) ?? DEFAULT_CAP;
    if (list.length >= cap) return { ok: false, reason: "cap" };
    list.push({ text: t, source, at: Date.now() });
    this.steer.set(runId, list);
    return { ok: true, depth: list.length };
  }

  enqueueFollowUp(runId: string, text: string): EnqueueResult {
    const t = text.trim();
    if (!t) return { ok: false, reason: "empty" };
    const list = this.followUp.get(runId) ?? [];
    const cap = this.caps.get(runId) ?? DEFAULT_CAP;
    if (list.length >= cap) return { ok: false, reason: "cap" };
    list.push(t);
    this.followUp.set(runId, list);
    return { ok: true, depth: list.length };
  }

  /** Drain steer messages for injection after a tool batch. */
  drainSteer(runId: string, mode: QueueMode = "one-at-a-time"): string[] {
    return takeSteer(this.steer, runId, mode).map((item) => formatSteerLine(item));
  }

  drainSteerItems(runId: string, mode: QueueMode = "one-at-a-time"): SteerItem[] {
    return takeSteer(this.steer, runId, mode);
  }

  /** Drain follow-ups after the run settles. */
  drainFollowUp(runId: string, mode: QueueMode = "one-at-a-time"): string[] {
    return take(this.followUp, runId, mode);
  }

  peekSteer(runId: string): number {
    return this.steer.get(runId)?.length ?? 0;
  }

  peekFollowUp(runId: string): number {
    return this.followUp.get(runId)?.length ?? 0;
  }

  /** On abort, return queued texts so the UI can restore the editor. */
  returnAll(runId: string): { steer: string[]; followUp: string[] } {
    const steer = (this.steer.get(runId) ?? []).map((item) => item.text);
    const followUp = this.followUp.get(runId) ?? [];
    this.steer.delete(runId);
    this.followUp.delete(runId);
    return { steer, followUp };
  }
}

function formatSteerLine(item: SteerItem): string {
  if (item.source === "operator") return item.text;
  return `[steer:${item.source}] ${item.text}`;
}

function takeSteer(map: Map<string, SteerItem[]>, runId: string, mode: QueueMode): SteerItem[] {
  const list = map.get(runId);
  if (!list?.length) return [];
  if (mode === "all") {
    map.delete(runId);
    return list;
  }
  const [first, ...rest] = list;
  if (rest.length) map.set(runId, rest);
  else map.delete(runId);
  return first ? [first] : [];
}

function take(map: Map<string, string[]>, runId: string, mode: QueueMode): string[] {
  const list = map.get(runId);
  if (!list?.length) return [];
  if (mode === "all") {
    map.delete(runId);
    return list;
  }
  const [first, ...rest] = list;
  if (rest.length) map.set(runId, rest);
  else map.delete(runId);
  return first ? [first] : [];
}
