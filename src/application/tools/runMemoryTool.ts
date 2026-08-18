import { MemoryNote, slugKey } from "../../domain/memory/MemoryNote.ts";
import { addBoard, formatBoard, isBoardKind, parseBoard, refuseMotiveChange } from "../psyche/board.ts";
import { boardKey } from "../psyche/keys.ts";
import type { EpisodeRepository, MemoryRepository } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runMemoryTool(
  memory: MemoryRepository,
  episodes: EpisodeRepository,
  call: ToolCall,
  ctx: { runId: string; agentId: string },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "").trim();
  try {
    switch (call.name) {
      case "memory_search": {
        const query = str("query");
        const notes = await memory.search(query, 8);
        const past = await episodes.search(query, 6);
        const noteLines = notes.map((note) => `- ${note.key} · ${note.title}\n  ${clip(note.body, 280)}`);
        const epLines = past.map((ep) => `- [${ep.outcome}] ${ep.goal} → ${clip(ep.nextHint, 160)}`);
        const parts = [
          noteLines.length ? `Memory:\n${noteLines.join("\n")}` : "",
          epLines.length ? `Episodes:\n${epLines.join("\n")}` : "",
        ].filter(Boolean);
        return parts.join("\n\n") || "No matching memory. Write a note with memory_write when you learn something.";
      }
      case "memory_write": {
        const title = str("title");
        const body = str("body");
        const key = slugKey(str("key") || title);
        const tags = str("tags").split(/[, ]+/).map((tag) => tag.trim()).filter(Boolean);
        const saved = await memory.save(new MemoryNote({
          key,
          title,
          body,
          tags,
          sourceRunId: ctx.runId,
          sourceAgentId: ctx.agentId,
        }));
        return `saved memory ${saved.key}`;
      }
      case "memory_read": {
        const note = await memory.get(str("key"));
        if (!note) return `error: memory not found: ${str("key")}`;
        return `${note.key}\n# ${note.title}\n${note.body}\ntags: ${note.tags.join(", ") || "(none)"}`;
      }
      case "board_read": {
        const note = await memory.get(boardKey(ctx.runId));
        return note?.body || "# Board\n(empty)";
      }
      case "board_write": {
        const kind = str("kind").toLowerCase();
        if (!isBoardKind(kind)) return "error: kind must be motive, action, operation, fact, blocker, decision, or note";
        const existing = await memory.get(boardKey(ctx.runId));
        const current = parseBoard(existing?.body ?? "");
        const locked = refuseMotiveChange(current, { kind, text: str("text") });
        if (locked) return locked;
        const entries = addBoard(current, { kind, text: str("text") });
        const saved = await memory.save(new MemoryNote({
          key: boardKey(ctx.runId),
          title: "Board",
          body: formatBoard(entries),
          tags: ["board", "psyche"],
          sourceRunId: ctx.runId,
          sourceAgentId: ctx.agentId,
        }));
        return `board ${saved.key}\n${formatBoard(entries)}`;
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function clip(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}
