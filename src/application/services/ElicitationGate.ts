/**
 * Mid-tool elicitation — pause tool-result delivery until the operator answers.
 * Concurrent elicitations keep the session paused until all resolve or timeout.
 */

export type ElicitationStatus = "open" | "answered" | "cancelled" | "timed_out";

export type ElicitationRecord = {
  id: string;
  sessionId: string;
  prompt: string;
  kind: "approval" | "clarify" | "risk";
  meta?: Record<string, string>;
  status: ElicitationStatus;
  answer?: string;
  createdAt: number;
};

export type ElicitationWaitResult =
  | { status: "answered"; record: ElicitationRecord }
  | { status: "timed_out"; record: ElicitationRecord }
  | { status: "cancelled"; record: ElicitationRecord };

type Waiter = {
  resolve: (result: ElicitationWaitResult) => void;
  timer?: ReturnType<typeof setTimeout>;
};

let seq = 0;

export class ElicitationGate {
  private readonly byId = new Map<string, ElicitationRecord>();
  private readonly bySession = new Map<string, Set<string>>();
  private readonly waiters = new Map<string, Waiter[]>();

  register(input: {
    sessionId: string;
    prompt: string;
    kind?: ElicitationRecord["kind"];
    meta?: Record<string, string>;
  }): ElicitationRecord {
    const id = `elic_${Date.now().toString(36)}_${(++seq).toString(36)}`;
    const record: ElicitationRecord = {
      id,
      sessionId: input.sessionId,
      prompt: input.prompt.trim(),
      kind: input.kind ?? "clarify",
      meta: input.meta,
      status: "open",
      createdAt: Date.now(),
    };
    this.byId.set(id, record);
    const set = this.bySession.get(input.sessionId) ?? new Set();
    set.add(id);
    this.bySession.set(input.sessionId, set);
    return record;
  }

  outstanding(sessionId: string): number {
    const set = this.bySession.get(sessionId);
    if (!set) return 0;
    let n = 0;
    for (const id of set) {
      if (this.byId.get(id)?.status === "open") n += 1;
    }
    return n;
  }

  isPaused(sessionId: string): boolean {
    return this.outstanding(sessionId) > 0;
  }

  peekOpen(sessionId: string): ElicitationRecord[] {
    const set = this.bySession.get(sessionId);
    if (!set) return [];
    return [...set]
      .map((id) => this.byId.get(id))
      .filter((row): row is ElicitationRecord => Boolean(row && row.status === "open"));
  }

  answer(id: string, text: string): ElicitationRecord | null {
    const record = this.byId.get(id);
    if (!record || record.status !== "open") return null;
    record.status = "answered";
    record.answer = text.trim();
    this.finish(record, { status: "answered", record });
    return record;
  }

  /** Answer the oldest open elicitation for a session (operator shorthand). */
  answerSession(sessionId: string, text: string): ElicitationRecord | null {
    const open = this.peekOpen(sessionId);
    const first = open[0];
    if (!first) return null;
    return this.answer(first.id, text);
  }

  cancel(id: string): ElicitationRecord | null {
    const record = this.byId.get(id);
    if (!record || record.status !== "open") return null;
    record.status = "cancelled";
    this.finish(record, { status: "cancelled", record });
    return record;
  }

  cancelSession(sessionId: string): number {
    let n = 0;
    for (const row of this.peekOpen(sessionId)) {
      if (this.cancel(row.id)) n += 1;
    }
    return n;
  }

  wait(id: string, timeoutMs = 120_000): Promise<ElicitationWaitResult> {
    const record = this.byId.get(id);
    if (!record) {
      return Promise.resolve({
        status: "cancelled",
        record: {
          id,
          sessionId: "",
          prompt: "",
          kind: "clarify",
          status: "cancelled",
          createdAt: Date.now(),
        },
      });
    }
    if (record.status === "answered") return Promise.resolve({ status: "answered", record });
    if (record.status === "cancelled") return Promise.resolve({ status: "cancelled", record });
    if (record.status === "timed_out") return Promise.resolve({ status: "timed_out", record });

    return new Promise((resolve) => {
      const waiter: Waiter = { resolve };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          if (record.status !== "open") return;
          record.status = "timed_out";
          this.finish(record, { status: "timed_out", record });
        }, timeoutMs);
      }
      const list = this.waiters.get(id) ?? [];
      list.push(waiter);
      this.waiters.set(id, list);
    });
  }

  private finish(record: ElicitationRecord, result: ElicitationWaitResult): void {
    const set = this.bySession.get(record.sessionId);
    if (set && record.status !== "open") set.delete(record.id);
    const list = this.waiters.get(record.id) ?? [];
    this.waiters.delete(record.id);
    for (const waiter of list) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
  }
}
