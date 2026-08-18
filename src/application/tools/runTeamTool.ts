import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import type { MemoryRepository, TeamPort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runTeamTool(
  team: TeamPort,
  memory: MemoryRepository,
  call: ToolCall,
  ctx: { runId: string; agentId: string; signal?: AbortSignal },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "").trim();
  try {
    switch (call.name) {
      case "plan_set": {
        const tasks = str("tasks")
          .split(/\n+/)
          .map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s*/, "").trim()}`)
          .filter((line) => line.length > 3);
        if (!tasks.length) return "error: plan needs at least one task";
        const key = `plan/${ctx.runId}`;
        await memory.save(new MemoryNote({
          key,
          title: `Plan for session ${ctx.runId}`,
          body: tasks.join("\n"),
          tags: ["plan"],
          sourceRunId: ctx.runId,
          sourceAgentId: ctx.agentId,
        }));
        return `plan saved (${tasks.length} tasks)\n${tasks.join("\n")}\nDelegate with agent_spawn / agent_delegate. Write results to memory.`;
      }
      case "agent_list": {
        const listed = await team.list();
        if (!listed.length) return "No specialists yet. agent_spawn a name and task, then agent_delegate.";
        return listed
          .map((agent) => `- ${agent.name} v${agent.version} · ${agent.taskClass} · ${agent.skills.join(", ") || "no skills"}`)
          .join("\n");
      }
      case "agent_spawn": {
        const spawned = await team.spawn({
          name: str("name"),
          task: str("task"),
          skills: str("skills").split(/[, ]+/).map((name) => name.trim()).filter(Boolean),
        });
        await memory.save(new MemoryNote({
          key: `agent/${spawned.name}`,
          title: `Specialist ${spawned.name}`,
          body: str("task"),
          tags: ["agent", ...spawned.skills],
          sourceRunId: ctx.runId,
          sourceAgentId: ctx.agentId,
        }));
        return `spawned ${spawned.name} (${spawned.id}) for: ${str("task")}. Next: agent_delegate agent=${spawned.name} task=...`;
      }
      case "agent_delegate": {
        const result = await team.delegate({
          parentRunId: ctx.runId,
          agent: str("agent"),
          task: str("task"),
          signal: ctx.signal,
        });
        return result;
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
