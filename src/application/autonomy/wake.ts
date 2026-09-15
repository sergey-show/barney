/**
 * Wake law: the agent does not background-reason.
 * It arms a wake → tick/process-exit delivers → normal turn resumes.
 *
 * Kinds: process_exit | process_log | at | defer | interval
 */

export type WakeKind = "process_exit" | "process_log" | "at" | "defer" | "interval";
export type WakeStatus = "armed" | "fired" | "cancelled" | "expired";

export type WakeItem = {
  id: string;
  runId: string;
  agentId: string;
  kind: WakeKind;
  status: WakeStatus;
  reason: string;
  createdAt: string;
  fireAt?: string;
  everyMs?: number;
  processId?: string;
  logMatch?: string;
  firedAt?: string;
};

export const WAKE_MAX_ARMED = 8;
export const WAKE_MIN_AFTER_MS = 15_000;
export const WAKE_MIN_EVERY_MS = 5 * 60_000;
export const WAKE_MAX_EVERY_MS = 24 * 60 * 60_000;

export function wakeMemoryKey(agentId: string): string {
  return `wake/${agentId}`;
}

export function parseWakes(body: string): WakeItem[] {
  try {
    const parsed = JSON.parse(body) as { items?: WakeItem[] } | WakeItem[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item?.id && item?.runId && item?.kind && item?.reason);
  } catch {
    return [];
  }
}

export function formatWakes(items: WakeItem[]): string {
  return JSON.stringify({ items }, null, 2);
}

export function newWakeId(): string {
  return `wake_${crypto.randomUUID().slice(0, 8)}`;
}

export function armCount(items: WakeItem[]): number {
  return items.filter((item) => item.status === "armed").length;
}

export function validateAfterMs(afterMs: number): string | null {
  if (!Number.isFinite(afterMs) || afterMs < WAKE_MIN_AFTER_MS) {
    return `afterMs must be >= ${WAKE_MIN_AFTER_MS}`;
  }
  if (afterMs > WAKE_MAX_EVERY_MS) return `afterMs must be <= ${WAKE_MAX_EVERY_MS}`;
  return null;
}

export function validateEveryMs(everyMs: number): string | null {
  if (!Number.isFinite(everyMs) || everyMs < WAKE_MIN_EVERY_MS) {
    return `everyMs must be >= ${WAKE_MIN_EVERY_MS}`;
  }
  if (everyMs > WAKE_MAX_EVERY_MS) return `everyMs must be <= ${WAKE_MAX_EVERY_MS}`;
  return null;
}

export function dueWakes(
  items: WakeItem[],
  nowMs: number,
  processStatus: Map<string, string>,
  processLogs: Map<string, string>,
): WakeItem[] {
  return items.filter((item) => {
    if (item.status !== "armed") return false;
    if (item.kind === "at" || item.kind === "defer" || item.kind === "interval") {
      if (!item.fireAt) return false;
      const at = Date.parse(item.fireAt);
      return Number.isFinite(at) && at <= nowMs;
    }
    if (item.kind === "process_exit" && item.processId) {
      const status = processStatus.get(item.processId);
      return Boolean(status && status !== "running");
    }
    if (item.kind === "process_log" && item.processId && item.logMatch) {
      const logs = processLogs.get(item.processId) ?? "";
      return logsIncludes(logs, item.logMatch);
    }
    return false;
  });
}

export function markWakeFired(items: WakeItem[], id: string, now = new Date().toISOString()): WakeItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    if (item.kind === "interval" && item.everyMs) {
      const next = new Date(Date.parse(now) + item.everyMs).toISOString();
      return { ...item, status: "armed", fireAt: next, firedAt: now };
    }
    return { ...item, status: "fired", firedAt: now };
  });
}

export function cancelWake(items: WakeItem[], id: string): WakeItem[] {
  return items.map((item) => (item.id === id && item.status === "armed" ? { ...item, status: "cancelled" } : item));
}

export function cancelWakesForProcess(items: WakeItem[], processId: string): WakeItem[] {
  return items.map((item) =>
    item.status === "armed" && item.processId === processId ? { ...item, status: "cancelled" } : item
  );
}

export function cancelWakesForRun(items: WakeItem[], runId: string): WakeItem[] {
  return items.map((item) =>
    item.status === "armed" && item.runId === runId ? { ...item, status: "cancelled" } : item
  );
}

export function wakePrompt(wake: WakeItem, extra = ""): string {
  const lines = [
    "A deferred wake fired. This is not a new operator request.",
    `Wake: ${wake.id} (${wake.kind})`,
    `Reason: ${wake.reason}`,
  ];
  if (wake.processId) lines.push(`Process: ${wake.processId}`);
  if (extra.trim()) lines.push(extra.trim());
  lines.push("Inspect process_list / process_logs if needed, then continue the session goal.");
  return lines.join("\n");
}

function logsIncludes(logs: string, match: string): boolean {
  const needle = match.trim();
  if (!needle) return false;
  if (needle.startsWith("/") && needle.lastIndexOf("/") > 0) {
    try {
      const last = needle.lastIndexOf("/");
      const body = needle.slice(1, last);
      const flags = needle.slice(last + 1) || "i";
      return new RegExp(body, flags).test(logs);
    } catch {
      return logs.toLowerCase().includes(needle.toLowerCase());
    }
  }
  return logs.toLowerCase().includes(needle.toLowerCase());
}
