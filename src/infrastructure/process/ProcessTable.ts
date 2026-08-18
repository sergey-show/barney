import type { ProcessPort } from "../../application/ports.ts";

const LOG_CAP = 160_000;

type Entry = {
  id: string;
  runId: string;
  pid: number;
  command: string;
  status: string;
  logs: string;
  proc: ReturnType<typeof Bun.spawn>;
};

export class ProcessTable implements ProcessPort {
  private readonly items = new Map<string, Entry>();

  async spawn(input: { runId: string; cwd: string; command: string; args: string[] }): Promise<{ id: string; pid: number }> {
    const proc = Bun.spawn([input.command, ...input.args], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const id = `proc_${crypto.randomUUID().slice(0, 8)}`;
    const entry: Entry = {
      id,
      runId: input.runId,
      pid: proc.pid,
      command: [input.command, ...input.args].join(" "),
      status: "running",
      logs: "",
      proc,
    };
    this.items.set(id, entry);
    void this.capture(entry);
    return { id, pid: proc.pid };
  }

  async list(runId: string): Promise<Array<{ id: string; pid: number; command: string; status: string }>> {
    return [...this.items.values()]
      .filter((e) => e.runId === runId)
      .map((e) => ({ id: e.id, pid: e.pid, command: e.command, status: e.status }));
  }

  async logs(id: string): Promise<string> {
    return this.items.get(id)?.logs ?? "";
  }

  async kill(id: string): Promise<void> {
    const entry = this.items.get(id);
    if (!entry) return;
    try {
      entry.proc.kill();
    } catch {
      /* already gone */
    }
    if (entry.status === "running") entry.status = "killed";
  }

  async killRun(runId: string): Promise<void> {
    await Promise.all(
      [...this.items.values()].filter((entry) => entry.runId === runId).map((entry) => this.kill(entry.id)),
    );
  }

  private async capture(entry: Entry): Promise<void> {
    await Promise.all([
      this.pump(entry, entry.proc.stdout),
      this.pump(entry, entry.proc.stderr),
    ]);
    const code = await entry.proc.exited;
    if (entry.status === "killed") return;
    entry.status = code === 0 ? "exited" : `exit_${code}`;
  }

  private async pump(entry: Entry, stream: ReadableStream<Uint8Array> | number | undefined): Promise<void> {
    if (!(stream instanceof ReadableStream)) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        entry.logs += decoder.decode(value, { stream: true });
        if (entry.logs.length > LOG_CAP) entry.logs = entry.logs.slice(-Math.floor(LOG_CAP * 0.8));
      }
    } catch {
      /* process killed */
    }
  }
}
