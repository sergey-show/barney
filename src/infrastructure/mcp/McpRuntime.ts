import type { McpRuntimePort, McpServer, McpToolInfo } from "../../application/ports.ts";

const PROTOCOL = "2024-11-05";
const REQUEST_MS = 20_000;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Session = {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  tools: McpToolInfo[];
  pending: Map<number, Pending>;
  nextId: number;
  buf: Buffer;
  stderr: string;
};

export class McpRuntime implements McpRuntimePort {
  private readonly sessions = new Map<string, Session>();

  async start(server: McpServer, cwd = process.cwd()): Promise<{ name: string; tools: McpToolInfo[] }> {
    await this.stop(server.name);
    if (!server.command.trim()) throw new Error(`mcp ${server.name}: empty command`);
    const proc = Bun.spawn([server.command, ...server.args], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: mcpEnv(server.env),
    });
    const session: Session = {
      name: server.name,
      proc,
      tools: [],
      pending: new Map(),
      nextId: 1,
      buf: Buffer.alloc(0),
      stderr: "",
    };
    this.sessions.set(server.name, session);
    void this.readStdout(session);
    void this.readStderr(session);
    try {
      await this.request(session, "initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "barney", version: "0.1.0" },
      });
      this.notify(session, "notifications/initialized");
      const listed = await this.request(session, "tools/list", {}) as { tools?: Array<{ name?: string; description?: string }> };
      session.tools = (listed.tools ?? []).map((tool) => ({
        name: String(tool.name ?? "").trim(),
        description: String(tool.description ?? "").trim(),
      })).filter((tool) => tool.name);
      return { name: server.name, tools: session.tools };
    } catch (err) {
      await this.stop(server.name);
      const detail = err instanceof Error ? err.message : String(err);
      const stderr = session.stderr.trim();
      throw new Error(`mcp ${server.name} failed to start: ${detail}${stderr ? `\n${stderr.slice(0, 800)}` : ""}`);
    }
  }

  async call(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const session = this.sessions.get(server);
    if (!session) throw new Error(`mcp ${server} is not running. mcp_start ${server} first.`);
    const result = await this.request(session, "tools/call", { name: tool, arguments: args }, signal) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? []).map((part) => part.text ?? "").filter(Boolean).join("\n") || JSON.stringify(result);
    if (result.isError) throw new Error(text);
    return text;
  }

  async stop(server: string): Promise<void> {
    const session = this.sessions.get(server);
    if (!session) return;
    this.sessions.delete(server);
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`mcp ${server} stopped`));
    }
    session.pending.clear();
    try {
      session.proc.kill();
    } catch {
      /* gone */
    }
  }

  running(): Array<{ name: string; tools: string[] }> {
    return [...this.sessions.values()].map((session) => ({
      name: session.name,
      tools: session.tools.map((tool) => tool.name),
    }));
  }

  private request(session: Session, method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = session.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`mcp ${session.name} timeout on ${method}`));
      }, REQUEST_MS);
      session.pending.set(id, { resolve, reject, timer });
      const abort = () => {
        session.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.write(session, { jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(session: Session, method: string, params?: unknown): void {
    this.write(session, { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  private write(session: Session, msg: unknown): void {
    const json = JSON.stringify(msg);
    const payload = Buffer.from(json, "utf8");
    const frame = Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"), payload]);
    const stdin = session.proc.stdin;
    if (!stdin || typeof stdin === "number") throw new Error(`mcp ${session.name}: stdin closed`);
    stdin.write(frame);
  }

  private async readStdout(session: Session): Promise<void> {
    const stream = session.proc.stdout;
    if (!(stream instanceof ReadableStream)) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        session.buf = Buffer.concat([session.buf, Buffer.from(value)]);
        this.drain(session);
      }
    } catch {
      /* killed */
    } finally {
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`mcp ${session.name} closed`));
      }
      session.pending.clear();
    }
  }

  private async readStderr(session: Session): Promise<void> {
    const stream = session.proc.stderr;
    if (!(stream instanceof ReadableStream)) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        session.stderr += decoder.decode(value, { stream: true });
        if (session.stderr.length > 8_000) session.stderr = session.stderr.slice(-6_000);
      }
    } catch {
      /* killed */
    }
  }

  private drain(session: Session): void {
    while (true) {
      const msg = takeFrame(session);
      if (!msg) return;
      if (msg.id === undefined || msg.id === null) continue;
      const pending = session.pending.get(Number(msg.id));
      if (!pending) continue;
      session.pending.delete(Number(msg.id));
      clearTimeout(pending.timer);
      if (msg.error) {
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message || JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    }
  }
}

function takeFrame(session: Session): { id?: number | string; result?: unknown; error?: unknown } | null {
  const headerEnd = session.buf.indexOf("\r\n\r\n");
  if (headerEnd >= 0) {
    const header = session.buf.subarray(0, headerEnd).toString("utf8");
    const len = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
    if (!Number.isFinite(len) || len < 0) {
      session.buf = session.buf.subarray(headerEnd + 4);
      return null;
    }
    const start = headerEnd + 4;
    if (session.buf.length < start + len) return null;
    const json = session.buf.subarray(start, start + len).toString("utf8");
    session.buf = session.buf.subarray(start + len);
    try {
      return JSON.parse(json) as { id?: number | string; result?: unknown; error?: unknown };
    } catch {
      return null;
    }
  }
  const peek = session.buf.subarray(0, Math.min(80, session.buf.length)).toString("utf8");
  if (/content-length/i.test(peek)) return null;
  const nl = session.buf.indexOf("\n");
  if (nl < 0) return null;
  const line = session.buf.subarray(0, nl).toString("utf8").trim();
  session.buf = session.buf.subarray(nl + 1);
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line) as { id?: number | string; result?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

function mcpEnv(extra?: Record<string, string>): Record<string, string> {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP"];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) env[key] = value;
  }
  return env;
}
