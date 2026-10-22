export class BusyError extends Error {
  readonly runId: string;
  constructor(runId: string, message = "a step is already running") {
    super(message);
    this.name = "BusyError";
    this.runId = runId;
  }
}

export class SessionLock {
  private readonly inflight = new Map<string, AbortController>();

  begin(runId: string, mode: "replace" | "reject" = "replace"): AbortController {
    const prev = this.inflight.get(runId);
    if (prev) {
      if (mode === "reject") throw new BusyError(runId);
      prev.abort();
    }
    const controller = new AbortController();
    this.inflight.set(runId, controller);
    return controller;
  }

  end(runId: string, controller: AbortController): void {
    if (this.inflight.get(runId) === controller) this.inflight.delete(runId);
  }

  cancel(runId: string): boolean {
    const controller = this.inflight.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  isRunning(runId: string): boolean {
    return this.inflight.has(runId);
  }

  isBusy(): boolean {
    return this.inflight.size > 0;
  }
}
