/**
 * Codemode — model writes a short JS script that calls allowlisted tools via `call(name, args)`.
 * Runs in-process with a hard timeout (Bun Function sandbox, not full VM isolation).
 */

export type CodemodeCall = (name: string, args: Record<string, unknown>) => Promise<string>;

export type CodemodeResult = {
  ok: boolean;
  output: string;
  calls: number;
};

const MAX_CALLS = 24;
const MAX_OUTPUT = 8_000;

export async function runCodemodeScript(input: {
  script: string;
  call: CodemodeCall;
  allowed: Set<string>;
  timeoutMs?: number;
}): Promise<CodemodeResult> {
  let calls = 0;
  const logs: string[] = [];
  const store = new Map<string, string>();
  const allowed = input.allowed;

  const api = {
    async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
      if (!allowed.has(name)) throw new Error(`codemode: tool not allowed: ${name}`);
      if (calls >= MAX_CALLS) throw new Error(`codemode: max ${MAX_CALLS} tool calls`);
      calls += 1;
      const out = await input.call(name, args ?? {});
      logs.push(`${name} → ${String(out).slice(0, 200)}`);
      return out;
    },
    store(key: string, value: string): void {
      store.set(String(key), String(value).slice(0, 4_000));
    },
    load(key: string): string {
      return store.get(String(key)) ?? "";
    },
    log(...parts: unknown[]): void {
      logs.push(parts.map((p) => String(p)).join(" ").slice(0, 400));
    },
  };

  const timeoutMs = input.timeoutMs ?? 20_000;
  const wrapped = `"use strict";\n${input.script}\n`;
  try {
    const fn = new Function("api", `return (async () => {\nconst { call, store, load, log } = api;\n${wrapped}\n})();`);
    const result = await Promise.race([
      fn(api),
      new Promise((_, reject) => setTimeout(() => reject(new Error("codemode: timeout")), timeoutMs)),
    ]);
    const text = result == null ? logs.join("\n") : String(result);
    return {
      ok: true,
      output: text.slice(0, MAX_OUTPUT) || "(codemode finished with no return)",
      calls,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      output: [`codemode error: ${msg}`, ...logs.slice(-8)].join("\n").slice(0, MAX_OUTPUT),
      calls,
    };
  }
}

export const CODEMODE_ALLOWED_DEFAULT = new Set([
  "fs_read",
  "fs_search",
  "grep",
  "glob",
  "ls",
  "memory_read",
  "memory_search",
]);
