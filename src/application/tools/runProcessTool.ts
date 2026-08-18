import { denyShell } from "../../domain/guard/ShellPolicy.ts";
import type { ProcessPort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";
import { wrapSandboxed } from "../../infrastructure/sandbox/OsSandbox.ts";

export async function runProcessTool(
  processes: ProcessPort,
  call: ToolCall,
  ctx: { runId: string; cwd: string },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "").trim();
  try {
    switch (call.name) {
      case "process_spawn": {
        const command = str("command");
        if (!command) return "error: command is required";
        const denied = denyShell(command);
        if (denied) return `error: blocked: ${denied}. Use fs_* inside the worktree.`;
        const invocation = shellInvocation(command);
        const launched = wrapSandboxed({ cwd: ctx.cwd, command: invocation.command, args: invocation.args });
        const started = await processes.spawn({
          runId: ctx.runId,
          cwd: ctx.cwd,
          command: launched.command,
          args: launched.args,
        });
        return `started ${started.id} pid=${started.pid}\nUse process_logs id=${started.id} (no 30s wall). process_kill to stop.`;
      }
      case "process_list": {
        const listed = await processes.list(ctx.runId);
        if (!listed.length) return "No background processes in this session. process_spawn a command to start one.";
        return listed.map((item) => `- ${item.id} pid=${item.pid} ${item.status}\n  ${item.command}`).join("\n");
      }
      case "process_logs": {
        const id = str("id");
        if (!id) return "error: id is required";
        const logs = await processes.logs(id);
        return logs.trim() || `(no output yet from ${id})`;
      }
      case "process_kill": {
        const id = str("id");
        if (!id) return "error: id is required";
        await processes.kill(id);
        return `killed ${id}`;
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function shellInvocation(command: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { command: "/bin/sh", args: ["-c", command] };
}
