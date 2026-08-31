/** Per-run last-landed / previous file bodies for session restore (not ~/.barney self_rollback). */

const MAX_BYTES = 200_000;
const stores = new Map<string, RunCheckpoints>();

export type RunCheckpoints = {
  /** Content on disk immediately before the latest mutate. */
  previous: Map<string, string>;
  /** Last content successfully written in this run (agent still validates it). */
  good: Map<string, string>;
};

export function checkpointsFor(runId: string): RunCheckpoints {
  let store = stores.get(runId);
  if (!store) {
    store = { previous: new Map(), good: new Map() };
    stores.set(runId, store);
  }
  return store;
}

export function clearCheckpoints(runId: string): void {
  stores.delete(runId);
}

export function normPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "") || path;
}

export function rememberPrevious(runId: string, path: string, content: string): void {
  if (content.length > MAX_BYTES) return;
  checkpointsFor(runId).previous.set(normPath(path), content);
}

export function rememberGood(runId: string, path: string, content: string): void {
  if (content.length > MAX_BYTES) return;
  const key = normPath(path);
  const store = checkpointsFor(runId);
  store.good.set(key, content);
  store.previous.set(key, content);
}

export function restoreBody(runId: string, path: string): { content: string; source: "good" | "previous" } | undefined {
  const key = normPath(path);
  const store = checkpointsFor(runId);
  const good = store.good.get(key);
  if (good != null) return { content: good, source: "good" };
  const previous = store.previous.get(key);
  if (previous != null) return { content: previous, source: "previous" };
}

export function hasRestore(runId: string, path: string): boolean {
  return Boolean(restoreBody(runId, path));
}

export function pathsWithRestore(runId: string): string[] {
  const store = checkpointsFor(runId);
  return [...new Set([...store.good.keys(), ...store.previous.keys()])];
}
