/**
 * Mid-run steer / post-settle follow-up queues.
 */

export type QueueMode = "one-at-a-time" | "all";

export class MessageQueue {
  private readonly steer = new Map<string, string[]>();
  private readonly followUp = new Map<string, string[]>();

  enqueueSteer(runId: string, text: string): void {
    const t = text.trim();
    if (!t) return;
    const list = this.steer.get(runId) ?? [];
    list.push(t);
    this.steer.set(runId, list);
  }

  enqueueFollowUp(runId: string, text: string): void {
    const t = text.trim();
    if (!t) return;
    const list = this.followUp.get(runId) ?? [];
    list.push(t);
    this.followUp.set(runId, list);
  }

  /** Drain steer messages for injection after a tool batch. */
  drainSteer(runId: string, mode: QueueMode = "one-at-a-time"): string[] {
    return take(this.steer, runId, mode);
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
    const steer = this.steer.get(runId) ?? [];
    const followUp = this.followUp.get(runId) ?? [];
    this.steer.delete(runId);
    this.followUp.delete(runId);
    return { steer, followUp };
  }
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
