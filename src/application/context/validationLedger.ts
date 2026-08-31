import { normPath } from "./fileCheckpoint.ts";

/** Per-run validation state from tool outcomes — not error prose or file-type catalogs. */

type RunLedger = {
  /** Paths successfully mutated this session (fs_write/edit/append/restore / shell redirect). */
  mutated: Set<string>;
  /** Written since last exit-0 shell run referenced the path. */
  unverified: Set<string>;
  /** Last exit-0 shell run referenced this path. */
  passedRun: Set<string>;
  /** fs_edit returned error: for this path. */
  failedEdit: Set<string>;
  /** Shell check exited non-zero while referencing this mutated path. */
  checkFailed: Set<string>;
};

const stores = new Map<string, RunLedger>();

/** File redirect (`> path`), not fd dup (`2>&1`). */
const FILE_REDIRECT = /(?:^|[\s;&|])(?:>{1,2}|tee)\s+(?!\d)(\S+)/g;

function ledgerFor(runId: string): RunLedger {
  let store = stores.get(runId);
  if (!store) {
    store = {
      mutated: new Set(),
      unverified: new Set(),
      passedRun: new Set(),
      failedEdit: new Set(),
      checkFailed: new Set(),
    };
    stores.set(runId, store);
  }
  return store;
}

export function clearLedger(runId: string): void {
  stores.delete(runId);
}

export function trackMutated(runId: string, path: string): void {
  const key = normPath(path);
  if (key) ledgerFor(runId).mutated.add(key);
}

export function mutatedPaths(runId: string): string[] {
  return [...ledgerFor(runId).mutated];
}

export function commandReferencesPath(command: string, path: string): boolean {
  if (!path) return false;
  if (command.includes(path)) return true;
  const base = path.split("/").filter(Boolean).at(-1);
  return Boolean(base && command.includes(base));
}

/** Session-mutated paths whose path string appears in the shell command. */
export function trackedPathsInCommand(runId: string, command: string): string[] {
  return mutatedPaths(runId).filter((path) => commandReferencesPath(command, path));
}

/** Absolute file-like paths in a shell command (shape only — not language catalogs). */
export function absoluteFilePathsInCommand(command: string): string[] {
  const found = new Set<string>();
  for (const match of command.matchAll(/(?:^|[\s="'(:])(\/[\w./-]+\.[\w.-]+)\b/g)) {
    const hit = match[1];
    if (hit) found.add(normPath(hit));
  }
  return [...found];
}

export function redirectTargetsInCommand(command: string): string[] {
  const found: string[] = [];
  for (const match of command.matchAll(FILE_REDIRECT)) {
    const raw = match[1]?.replace(/^['"]|['"]$/g, "") ?? "";
    if (!raw || raw.startsWith("&") || /^\d+$/.test(raw)) continue;
    found.push(normPath(raw));
  }
  return found;
}

export function shellExitCode(out: string): number | null {
  const hit = out.match(/^exit (\d+)(?:\n|$)/);
  return hit ? Number(hit[1]) : null;
}

export function shellStdout(out: string): string {
  return out.replace(/^exit \d+\n?/, "").trim();
}

/** Exit 0 with no stdout — structural only. */
export function runOutputLooksIncomplete(stdout: string): boolean {
  return !stdout.replace(/^\(no output\)$/i, "").trim();
}

export function markUnverified(runId: string, path: string): void {
  const key = normPath(path);
  if (!key) return;
  ledgerFor(runId).unverified.add(key);
  ledgerFor(runId).passedRun.delete(key);
}

export function markPassedRun(runId: string, path: string): void {
  const key = normPath(path);
  if (!key) return;
  const store = ledgerFor(runId);
  store.passedRun.add(key);
  store.unverified.delete(key);
  store.failedEdit.delete(key);
  store.checkFailed.delete(key);
}

export function markFailedEdit(runId: string, path: string): void {
  const key = normPath(path);
  if (key) ledgerFor(runId).failedEdit.add(key);
}

export function clearFailedEdit(runId: string, path: string): void {
  ledgerFor(runId).failedEdit.delete(normPath(path));
}

export function markCheckFailed(runId: string, path: string): void {
  const key = normPath(path);
  if (!key) return;
  const store = ledgerFor(runId);
  store.checkFailed.add(key);
  store.passedRun.delete(key);
  store.unverified.add(key);
}

export function clearCheckFailed(runId: string, path: string): void {
  ledgerFor(runId).checkFailed.delete(normPath(path));
}

export function checkFailedPaths(runId: string): string[] {
  return [...ledgerFor(runId).checkFailed];
}

export function wasPassedRun(runId: string, path: string): boolean {
  return ledgerFor(runId).passedRun.has(normPath(path));
}

export function failedEditPaths(runId: string): string[] {
  return [...ledgerFor(runId).failedEdit];
}

export function unverifiedPaths(runId: string): string[] {
  return [...ledgerFor(runId).unverified];
}

export function validationPinLine(runId: string, requested: string[]): string {
  const store = ledgerFor(runId);
  const lines: string[] = [];
  const miss = requested.filter((path) => store.unverified.has(normPath(path)));
  if (miss.length) {
    lines.push(`Written but not validated since last edit: ${miss.join(", ")} — run a check via shell before claiming done.`);
  }
  const failed = requested.filter((path) => store.checkFailed.has(normPath(path)));
  const failedAny = [...store.checkFailed];
  if (failed.length) {
    lines.push(`Check failed on: ${failed.join(", ")} — fix minimally or fs_restore; do not chain more patches on the same broken file.`);
  } else if (failedAny.length) {
    lines.push(`Check failed on: ${failedAny.join(", ")} — fix minimally or fs_restore; do not chain more patches on the same broken file.`);
  }
  return lines.join("\n");
}

export function pathsMatch(a: string, b: string): boolean {
  const left = normPath(a);
  const right = normPath(b);
  return left === right || left.endsWith(right) || right.endsWith(left);
}
