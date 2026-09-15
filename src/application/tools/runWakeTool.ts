import { MemoryNote } from "../../domain/memory/MemoryNote.ts";
import type { MemoryRepository, ProcessPort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";
import {
  armCount,
  cancelWake,
  formatWakes,
  newWakeId,
  parseWakes,
  validateAfterMs,
  validateEveryMs,
  WAKE_MAX_ARMED,
  wakeMemoryKey,
  type WakeItem,
  type WakeKind,
} from "../autonomy/wake.ts";

export async function runWakeTool(
  memories: MemoryRepository,
  processes: ProcessPort,
  call: ToolCall,
  ctx: { runId: string; agentId: string },
): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "").trim();
  const key = wakeMemoryKey(ctx.agentId);
  try {
    switch (call.name) {
      case "wake_when_process": {
        const processId = str("processId") || str("id");
        const on = (str("on") || "exit").toLowerCase();
        const reason = str("reason") || "process settled";
        const match = str("match") || str("logMatch");
        if (!processId) return "error: processId is required";
        const proc = await processes.get(processId);
        if (!proc) return `error: unknown process ${processId}`;
        if (proc.runId !== ctx.runId) return "error: process belongs to another session";
        const kind: WakeKind = on === "log" || on === "process_log" ? "process_log" : "process_exit";
        if (kind === "process_log" && !match) return "error: match is required for on=log";
        const items = await load(memories, key);
        if (armCount(items) >= WAKE_MAX_ARMED) return `error: at most ${WAKE_MAX_ARMED} armed wakes`;
        const wake: WakeItem = {
          id: newWakeId(),
          runId: ctx.runId,
          agentId: ctx.agentId,
          kind,
          status: "armed",
          reason,
          createdAt: new Date().toISOString(),
          processId,
          logMatch: kind === "process_log" ? match : undefined,
        };
        await save(memories, key, ctx.agentId, [...items, wake]);
        return kind === "process_log"
          ? `armed ${wake.id}: wake when ${processId} logs match ${JSON.stringify(match)}`
          : `armed ${wake.id}: wake when ${processId} exits (tick delivers; use wake_list)`;
      }
      case "wake_at": {
        const reason = str("reason") || "scheduled check";
        const afterRaw = str("afterMs") || str("after");
        const atRaw = str("at");
        const everyRaw = str("everyMs") || str("every");
        const items = await load(memories, key);
        if (armCount(items) >= WAKE_MAX_ARMED) return `error: at most ${WAKE_MAX_ARMED} armed wakes`;
        let kind: WakeKind = "defer";
        let fireAt: string | undefined;
        let everyMs: number | undefined;
        if (everyRaw) {
          everyMs = Number(everyRaw);
          const err = validateEveryMs(everyMs);
          if (err) return `error: ${err}`;
          kind = "interval";
          fireAt = new Date(Date.now() + everyMs).toISOString();
        } else if (atRaw) {
          const ms = Date.parse(atRaw);
          if (!Number.isFinite(ms)) return "error: at must be an ISO timestamp";
          if (ms < Date.now() + 5_000) return "error: at must be at least a few seconds in the future";
          kind = "at";
          fireAt = new Date(ms).toISOString();
        } else if (afterRaw) {
          const afterMs = Number(afterRaw);
          const err = validateAfterMs(afterMs);
          if (err) return `error: ${err}`;
          kind = "defer";
          fireAt = new Date(Date.now() + afterMs).toISOString();
        } else {
          return "error: provide afterMs, at (ISO), or everyMs";
        }
        const wake: WakeItem = {
          id: newWakeId(),
          runId: ctx.runId,
          agentId: ctx.agentId,
          kind,
          status: "armed",
          reason,
          createdAt: new Date().toISOString(),
          fireAt,
          everyMs,
        };
        await save(memories, key, ctx.agentId, [...items, wake]);
        return `armed ${wake.id}: ${kind} at ${fireAt} — ${reason}`;
      }
      case "wake_list": {
        const items = await load(memories, key);
        const mine = items.filter((item) => item.runId === ctx.runId || item.status === "armed");
        if (!mine.length) return "No wakes. Use wake_when_process or wake_at.";
        return mine
          .slice(-20)
          .map((item) =>
            `- ${item.id} ${item.status} ${item.kind} run=${item.runId.slice(0, 8)} ${item.fireAt ? `at=${item.fireAt}` : ""} ${item.processId ?? ""} — ${item.reason}`
              .replace(/\s+/g, " ")
              .trim()
          )
          .join("\n");
      }
      case "wake_cancel": {
        const id = str("id");
        if (!id) return "error: id is required";
        const items = await load(memories, key);
        const found = items.find((item) => item.id === id);
        if (!found) return `error: unknown wake ${id}`;
        await save(memories, key, ctx.agentId, cancelWake(items, id));
        return `cancelled ${id}`;
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function load(memories: MemoryRepository, key: string): Promise<WakeItem[]> {
  return parseWakes((await memories.get(key))?.body ?? "");
}

async function save(memories: MemoryRepository, key: string, agentId: string, items: WakeItem[]): Promise<void> {
  await memories.save(new MemoryNote({
    key,
    title: "Wakes",
    body: formatWakes(items.slice(-80)),
    tags: ["wake", "autonomy"],
    sourceAgentId: agentId,
  }));
}
