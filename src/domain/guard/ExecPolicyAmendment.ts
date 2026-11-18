/**
 * Mutable exec-policy amendments — remember operator allows without weakening hard deny.
 */

import { denyShell } from "./ShellPolicy.ts";

export type ExecAmendmentKind = "allow_prefix" | "deny_prefix";

export type ExecPolicyAmendment = {
  id: string;
  kind: ExecAmendmentKind;
  /** Normalized command prefix (first tokens). */
  prefix: string;
  source: "operator" | "auto";
  createdAt: string;
  refs: string[];
};

export type ExecPolicyStore = {
  amendments: ExecPolicyAmendment[];
  updatedAt: string;
};

export function emptyExecPolicy(now = new Date().toISOString()): ExecPolicyStore {
  return { amendments: [], updatedAt: now };
}

export function execPolicyMemoryKey(agentId: string): string {
  return `policy/exec/${agentId}`;
}

export function parseExecPolicy(body: string): ExecPolicyStore {
  try {
    const parsed = JSON.parse(body) as ExecPolicyStore;
    if (parsed && Array.isArray(parsed.amendments)) {
      return {
        amendments: parsed.amendments.map(normalizeAmendment).filter(Boolean) as ExecPolicyAmendment[],
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    /* fallthrough */
  }
  return emptyExecPolicy();
}

export function formatExecPolicy(store: ExecPolicyStore): string {
  return JSON.stringify({
    amendments: store.amendments,
    updatedAt: store.updatedAt || new Date().toISOString(),
  }, null, 2);
}

function normalizeAmendment(row: ExecPolicyAmendment): ExecPolicyAmendment | null {
  const prefix = normalizeCommandPrefix(row?.prefix ?? "");
  if (!prefix) return null;
  const kind = row.kind === "deny_prefix" ? "deny_prefix" : "allow_prefix";
  return {
    id: String(row.id || `amd_${hashPrefix(prefix)}`),
    kind,
    prefix,
    source: row.source === "auto" ? "auto" : "operator",
    createdAt: row.createdAt || new Date().toISOString(),
    refs: Array.isArray(row.refs) ? row.refs.map(String).slice(0, 8) : [],
  };
}

export function normalizeCommandPrefix(command: string, maxTokens = 3): string {
  const text = command.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.split(" ").slice(0, maxTokens).join(" ");
}

export function commandMatchesPrefix(command: string, prefix: string): boolean {
  const cmd = command.replace(/\s+/g, " ").trim();
  const pre = normalizeCommandPrefix(prefix, 12);
  if (!cmd || !pre) return false;
  return cmd === pre || cmd.startsWith(`${pre} `) || cmd.startsWith(pre);
}

export function proposeAmendmentFromApproval(command: string, source: "operator" | "auto" = "operator"): ExecPolicyAmendment | null {
  const prefix = normalizeCommandPrefix(command);
  if (!prefix || prefix.length < 2) return null;
  // Never propose allow for hard-denied shapes.
  if (denyShell(command)) return null;
  return {
    id: `amd_${hashPrefix(prefix)}`,
    kind: "allow_prefix",
    prefix,
    source,
    createdAt: new Date().toISOString(),
    refs: [`cmd:${prefix}`],
  };
}

export function upsertAmendment(store: ExecPolicyStore, amendment: ExecPolicyAmendment): ExecPolicyStore {
  const next = normalizeAmendment(amendment);
  if (!next) return store;
  const rest = store.amendments.filter((row) => !(row.kind === next.kind && row.prefix === next.prefix));
  return {
    amendments: [next, ...rest].slice(0, 64),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate shell against hard deny + amendments.
 * Hard deny always wins. Deny amendments next. Allow amendments only skip the approval ask — they do not bypass denyShell.
 */
export function evaluateExecPolicy(
  command: string,
  amendments: ExecPolicyAmendment[] = [],
): { allowed: boolean; reason: string | null; matched?: ExecPolicyAmendment } {
  const hard = denyShell(command);
  if (hard) return { allowed: false, reason: hard };
  for (const row of amendments) {
    if (row.kind !== "deny_prefix") continue;
    if (commandMatchesPrefix(command, row.prefix)) {
      return { allowed: false, reason: `policy deny: ${row.prefix}`, matched: row };
    }
  }
  for (const row of amendments) {
    if (row.kind !== "allow_prefix") continue;
    if (commandMatchesPrefix(command, row.prefix)) {
      return { allowed: true, reason: null, matched: row };
    }
  }
  return { allowed: true, reason: null };
}

export function isTrustedByAmendments(command: string, amendments: ExecPolicyAmendment[]): boolean {
  const result = evaluateExecPolicy(command, amendments);
  return Boolean(result.allowed && result.matched?.kind === "allow_prefix");
}

function hashPrefix(prefix: string): string {
  let h = 0;
  for (let i = 0; i < prefix.length; i++) h = (h * 31 + prefix.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}
