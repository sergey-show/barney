/**
 * Individuation — typed Light/Shadow ledger + deterministic self-appraisal.
 * Samost string lists are a projection; capability/skills stay the statistical canon.
 */

import type { ReuseKind } from "../context/transferLedger.ts";
import type { ExperienceRecallBags } from "../experience/experienceRecall.ts";
import { experienceRecallHit } from "../experience/experienceRecall.ts";
import type { CapabilityEntry } from "../context/capabilityMap.ts";
import type { Samost } from "./samost.ts";
import { absorbIntoSamost, formatSamost, parseSamost, seedSamost } from "./samost.ts";

export const SELF_LEDGER_KEY_PREFIX = "self/ledger/";
export const LIGHT_CAP_PER_KIND = 12;
export const SHADOW_CAP_PER_KIND = 12;
export const SELF_LEDGER_CAP = 40;

export type LightKind = "skill" | "method" | "tooling" | "domain" | "stance";
export type ShadowKind = "fail" | "rejected" | "unused" | "limit" | "blind";

export type LightEntry = {
  id: string;
  kind: LightKind;
  claim: string;
  refs: string[];
  confidence: number;
  wins: number;
  transfers: number;
  lastHelpedAt?: string;
  band: "strong" | "ok";
  status: "active" | "archived";
};

export type ShadowEntry = {
  id: string;
  kind: ShadowKind;
  claim: string;
  refs: string[];
  weight: number;
  lastSeenAt: string;
  counterLight?: string[];
  status: "active" | "archived";
};

export type SelfLedger = {
  light: LightEntry[];
  shadow: ShadowEntry[];
  updatedAt: string;
};

export type AppraisalVerdict = "competent" | "partial" | "blind" | "constrained";
export type AppraisalPath = "act" | "study" | "self_run" | "fork" | "park";

export type SelfAppraisal = {
  verdict: AppraisalVerdict;
  path: AppraisalPath;
  rationale: string;
  light: LightEntry[];
  shadow: ShadowEntry[];
  line: string;
};

export type BlindAction = "study" | "self_run" | "act";
export type ConstrainedAction = "park" | "act";
export type ConflictAction = "fork" | "act";

export function selfLedgerKey(agentId: string): string {
  return `${SELF_LEDGER_KEY_PREFIX}${agentId}`;
}

export function emptyLedger(now = new Date().toISOString()): SelfLedger {
  return { light: [], shadow: [], updatedAt: now };
}

export function parseSelfLedger(body: string): SelfLedger {
  try {
    const parsed = JSON.parse(body) as SelfLedger;
    if (parsed && Array.isArray(parsed.light) && Array.isArray(parsed.shadow)) {
      return {
        light: parsed.light.map(normalizeLight),
        shadow: parsed.shadow.map(normalizeShadow),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    /* fallthrough */
  }
  return emptyLedger();
}

export function formatSelfLedger(ledger: SelfLedger): string {
  return JSON.stringify({
    light: ledger.light,
    shadow: ledger.shadow,
    updatedAt: ledger.updatedAt || new Date().toISOString(),
  }, null, 2);
}

function normalizeLight(row: LightEntry): LightEntry {
  return {
    id: row.id,
    kind: row.kind,
    claim: String(row.claim ?? "").trim(),
    refs: [...(row.refs ?? [])],
    confidence: Number(row.confidence) || 0.4,
    wins: Number(row.wins) || 0,
    transfers: Number(row.transfers) || 0,
    lastHelpedAt: row.lastHelpedAt,
    band: row.band === "strong" ? "strong" : "ok",
    status: row.status === "archived" ? "archived" : "active",
  };
}

function normalizeShadow(row: ShadowEntry): ShadowEntry {
  return {
    id: row.id,
    kind: row.kind,
    claim: String(row.claim ?? "").trim(),
    refs: [...(row.refs ?? [])],
    weight: Number(row.weight) || 1,
    lastSeenAt: row.lastSeenAt || new Date().toISOString(),
    counterLight: row.counterLight,
    status: row.status === "archived" ? "archived" : "active",
  };
}

export function lightId(kind: LightKind, refs: string[]): string {
  return `light:${kind}:${refs.map((r) => r.toLowerCase()).sort().join("|") || "x"}`;
}

export function shadowId(kind: ShadowKind, refs: string[]): string {
  return `shadow:${kind}:${refs.map((r) => r.toLowerCase()).sort().join("|") || "x"}`;
}

/** Upsert Light — requires refs; no vanity claims. */
export function upsertLight(ledger: SelfLedger, input: {
  kind: LightKind;
  claim: string;
  refs: string[];
  confidence?: number;
  band?: "strong" | "ok";
  helped?: boolean;
  transfer?: boolean;
  now?: string;
}): SelfLedger {
  const refs = uniq(input.refs.map((r) => r.trim()).filter(Boolean));
  if (!refs.length) return ledger;
  const claim = input.claim.replace(/\s+/g, " ").trim();
  if (!claim || /i am (an? )?(expert|great|best)/i.test(claim)) return ledger;
  if (input.kind === "stance") return ledger; // almost never auto-write
  const now = input.now ?? new Date().toISOString();
  const id = lightId(input.kind, refs);
  const existing = ledger.light.find((row) => row.id === id);
  const nextRow: LightEntry = {
    id,
    kind: input.kind,
    claim: claim.slice(0, 180),
    refs,
    confidence: clamp01(input.confidence ?? existing?.confidence ?? 0.45),
    wins: (existing?.wins ?? 0) + (input.helped ? 1 : 0),
    transfers: (existing?.transfers ?? 0) + (input.transfer ? 1 : 0),
    lastHelpedAt: input.helped ? now : existing?.lastHelpedAt,
    band: input.band ?? existing?.band ?? "ok",
    status: "active",
  };
  if (input.helped) nextRow.confidence = clamp01(nextRow.confidence + 0.05);
  if (input.transfer) nextRow.confidence = clamp01(nextRow.confidence + 0.08);
  if (nextRow.wins >= 3 && nextRow.confidence >= 0.55) nextRow.band = "strong";
  const light = [nextRow, ...ledger.light.filter((row) => row.id !== id)];
  return capLedger({ ...ledger, light, updatedAt: now });
}

/** Upsert Shadow — typed; rejected only when caller asserts pathChanged. */
export function upsertShadow(ledger: SelfLedger, input: {
  kind: ShadowKind;
  claim: string;
  refs: string[];
  weight?: number;
  pathChanged?: boolean;
  counterLight?: string[];
  now?: string;
}): SelfLedger {
  if (input.kind === "rejected" && !input.pathChanged) return ledger;
  const refs = uniq(input.refs.map((r) => r.trim()).filter(Boolean));
  const claim = input.claim.replace(/\s+/g, " ").trim();
  if (!claim) return ledger;
  const now = input.now ?? new Date().toISOString();
  const id = shadowId(input.kind, refs.length ? refs : [claim.slice(0, 40)]);
  const existing = ledger.shadow.find((row) => row.id === id);
  const nextRow: ShadowEntry = {
    id,
    kind: input.kind,
    claim: claim.slice(0, 180),
    refs: refs.length ? refs : existing?.refs ?? [],
    weight: Math.min(10, (existing?.weight ?? 0) + (input.weight ?? 1)),
    lastSeenAt: now,
    counterLight: input.counterLight ?? existing?.counterLight,
    status: "active",
  };
  const shadow = [nextRow, ...ledger.shadow.filter((row) => row.id !== id)];
  return capLedger({ ...ledger, shadow, updatedAt: now });
}

export function demoteLightToShadow(ledger: SelfLedger, lightIdOrRef: string, reason: string): SelfLedger {
  const row = ledger.light.find((item) => item.id === lightIdOrRef || item.refs.includes(lightIdOrRef));
  if (!row) return ledger;
  let next = {
    ...ledger,
    light: ledger.light.map((item) =>
      item.id === row.id ? { ...item, status: "archived" as const } : item),
  };
  next = upsertShadow(next, {
    kind: "fail",
    claim: `Light demoted: ${row.claim} · ${reason}`,
    refs: row.refs,
    weight: 2,
  });
  return next;
}

export function archiveShadow(ledger: SelfLedger, id: string): SelfLedger {
  return {
    ...ledger,
    shadow: ledger.shadow.map((row) => row.id === id ? { ...row, status: "archived" } : row),
    updatedAt: new Date().toISOString(),
  };
}

function capLedger(ledger: SelfLedger): SelfLedger {
  const lightByKind = new Map<LightKind, LightEntry[]>();
  for (const row of ledger.light.filter((r) => r.status === "active")) {
    const list = lightByKind.get(row.kind) ?? [];
    list.push(row);
    lightByKind.set(row.kind, list);
  }
  const lightActive: LightEntry[] = [];
  for (const [, list] of lightByKind) {
    lightActive.push(
      ...list.sort((a, b) => b.confidence - a.confidence || b.wins - a.wins).slice(0, LIGHT_CAP_PER_KIND),
    );
  }
  const shadowByKind = new Map<ShadowKind, ShadowEntry[]>();
  for (const row of ledger.shadow.filter((r) => r.status === "active")) {
    const list = shadowByKind.get(row.kind) ?? [];
    list.push(row);
    shadowByKind.set(row.kind, list);
  }
  const shadowActive: ShadowEntry[] = [];
  for (const [, list] of shadowByKind) {
    shadowActive.push(
      ...list.sort((a, b) => b.weight - a.weight).slice(0, SHADOW_CAP_PER_KIND),
    );
  }
  const archivedLight = ledger.light.filter((r) => r.status === "archived").slice(0, 20);
  const archivedShadow = ledger.shadow.filter((r) => r.status === "archived").slice(0, 20);
  let light = [...lightActive, ...archivedLight];
  let shadow = [...shadowActive, ...archivedShadow];
  const activeTotal = lightActive.length + shadowActive.length;
  if (activeTotal > SELF_LEDGER_CAP) {
    // Drop weakest actives first.
    const weakLight = [...lightActive].sort((a, b) => a.confidence - b.confidence);
    const weakShadow = [...shadowActive].sort((a, b) => a.weight - b.weight);
    const drop = activeTotal - SELF_LEDGER_CAP;
    const dropIds = new Set<string>();
    for (let i = 0; i < drop; i += 1) {
      const s = weakShadow[i];
      const l = weakLight[i];
      if (s && (!l || s.weight <= l.confidence * 5)) dropIds.add(s.id);
      else if (l) dropIds.add(l.id);
    }
    light = light.map((row) => dropIds.has(row.id) ? { ...row, status: "archived" as const } : row);
    shadow = shadow.map((row) => dropIds.has(row.id) ? { ...row, status: "archived" as const } : row);
  }
  return { ...ledger, light, shadow };
}

/** Plastic prune: archive low-utility actives. */
export function pruneSelfLedger(ledger: SelfLedger, nowMs = Date.now()): SelfLedger {
  const light = ledger.light.map((row) => {
    if (row.status !== "active") return row;
    const age = row.lastHelpedAt ? (nowMs - Date.parse(row.lastHelpedAt)) / 86_400_000 : 99;
    if (row.confidence < 0.35 && row.wins === 0) return { ...row, status: "archived" as const };
    if (age > 45 && row.wins + row.transfers < 2) return { ...row, status: "archived" as const };
    return row;
  });
  const shadow = ledger.shadow.map((row) => {
    if (row.status !== "active") return row;
    const age = (nowMs - Date.parse(row.lastSeenAt)) / 86_400_000;
    if (row.weight < 1.5 && age > 21) return { ...row, status: "archived" as const };
    if (age > 60) return { ...row, status: "archived" as const };
    return row;
  });
  return capLedger({ ...ledger, light, shadow, updatedAt: new Date().toISOString() });
}

/** Sync projection from capability map (canon → Light strong/ok, Shadow blind). */
export function syncFromCapability(ledger: SelfLedger, entries: CapabilityEntry[]): SelfLedger {
  let next = ledger;
  for (const entry of entries) {
    if (entry.kind === "skill" && (entry.band === "strong" || entry.band === "ok")) {
      next = upsertLight(next, {
        kind: "skill",
        claim: `Skill ${entry.key} · ${entry.band} · ${entry.hint}`,
        refs: [`skill:${entry.key}`],
        confidence: clamp01(0.4 + entry.strength * 0.4),
        band: entry.band === "strong" ? "strong" : "ok",
      });
    }
    if (entry.band === "weak" || entry.band === "decay") {
      next = upsertShadow(next, {
        kind: "blind",
        claim: `Blind/weak: ${entry.key} · ${entry.band} · ${entry.hint}`,
        refs: [`cap:${entry.key}`],
        weight: entry.fails >= 2 ? 2 : 1,
      });
    }
  }
  return next;
}

export function pickRelevantLight(ledger: SelfLedger, query: string, limit = 4): LightEntry[] {
  return rankByQuery(
    ledger.light.filter((row) => row.status === "active"),
    query,
    (row) => `${row.claim} ${row.refs.join(" ")}`,
    limit,
  );
}

export function pickRelevantShadow(ledger: SelfLedger, query: string, limit = 4): ShadowEntry[] {
  return rankByQuery(
    ledger.shadow.filter((row) => row.status === "active"),
    query,
    (row) => `${row.claim} ${row.refs.join(" ")} ${row.kind}`,
    limit,
  );
}

function rankByQuery<T>(
  rows: T[],
  query: string,
  textOf: (row: T) => string,
  limit: number,
): T[] {
  if (!rows.length || limit <= 0) return [];
  const tokens = tokenize(query);
  const scored = rows.map((row, index) => {
    const text = textOf(row).toLowerCase();
    const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
    return { row, hits, index };
  });
  const matched = scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index);
  if (matched.length) return matched.slice(0, limit).map((s) => s.row);
  return rows.slice(0, Math.min(2, limit));
}

/**
 * Deterministic appraisal — no LLM.
 * Table: blind → study|self_run; constrained → park; conflict → fork; else competent/partial → act.
 */
export function appraiseSelf(input: {
  query: string;
  reuse: ReuseKind;
  bags: ExperienceRecallBags;
  ledger: SelfLedger;
  capability?: CapabilityEntry[];
  constrained?: boolean;
  conflictMethods?: boolean;
  allowSkip?: boolean;
  onBlind?: BlindAction;
  onConstrained?: ConstrainedAction;
  onConflict?: ConflictAction;
}): SelfAppraisal {
  if (input.allowSkip) {
    return {
      verdict: "competent",
      path: "act",
      rationale: "greeting/skip",
      light: [],
      shadow: [],
      line: "self_appraisal: verdict=competent path=act · skip",
    };
  }
  const light = pickRelevantLight(input.ledger, input.query, 4);
  const shadow = pickRelevantShadow(input.ledger, input.query, 4);
  const bagsHit = experienceRecallHit(input.bags);
  const blindShadow = shadow.filter((s) => s.kind === "blind" || s.kind === "fail");
  const limitShadow = shadow.some((s) => s.kind === "limit") || input.constrained;
  const strongLight = light.filter((l) => l.band === "strong" || l.confidence >= 0.55);
  const onBlind = input.onBlind ?? "study";
  const onConstrained = input.onConstrained ?? "park";
  const onConflict = input.onConflict ?? "fork";

  if (limitShadow && !strongLight.length) {
    const path: AppraisalPath = onConstrained === "park" ? "park" : "act";
    return finish("constrained", path, "limits dominate without strong Light", light, shadow);
  }
  if (
    input.reuse === "fresh"
    && !bagsHit
    && (!strongLight.length || blindShadow.some((s) => s.weight >= 2))
  ) {
    const path: AppraisalPath = onBlind === "act" ? "act" : onBlind === "self_run" ? "self_run" : "study";
    return finish("blind", path, "fresh + empty bags / blind zone", light, shadow);
  }
  if (input.conflictMethods && strongLight.length >= 2) {
    const path: AppraisalPath = onConflict === "fork" ? "fork" : "act";
    return finish("partial", path, "competing methods", light, shadow);
  }
  if (strongLight.length && blindShadow.length === 0) {
    return finish("competent", "act", "strong Light covers task", light, shadow);
  }
  if (light.length || bagsHit) {
    return finish("partial", "act", "partial Light or recall hit — act with Shadow caution", light, shadow);
  }
  const path: AppraisalPath = onBlind === "act" ? "act" : onBlind === "self_run" ? "self_run" : "study";
  return finish("blind", path, "no Light and no bags", light, shadow);
}

function finish(
  verdict: AppraisalVerdict,
  path: AppraisalPath,
  rationale: string,
  light: LightEntry[],
  shadow: ShadowEntry[],
): SelfAppraisal {
  const line = [
    `self_appraisal: verdict=${verdict} path=${path}`,
    `light=${light.length} shadow=${shadow.length}`,
    rationale,
  ].join(" · ");
  return { verdict, path, rationale, light, shadow, line };
}

export function renderAppraisalPrompt(appraisal: SelfAppraisal): string {
  const lightLines = appraisal.light.map((row) => `- [${row.kind}/${row.band}] ${row.claim}`);
  const shadowLines = appraisal.shadow.map((row) => `- [${row.kind}·w${row.weight}] ${row.claim}`);
  return [
    `Self-appraisal: ${appraisal.verdict} → ${appraisal.path}`,
    appraisal.rationale,
    lightLines.length ? `Light:\n${lightLines.join("\n")}` : "Light: (none for this turn)",
    shadowLines.length ? `Shadow:\n${shadowLines.join("\n")}` : "Shadow: (none for this turn)",
  ].join("\n");
}

/** Project ledger into samost Light/Shadow bullet strings for UI + legacy prompt. */
export function projectSamost(samost: Samost, ledger: SelfLedger): Samost {
  const light = ledger.light
    .filter((row) => row.status === "active")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map((row) => row.claim);
  const shadow = ledger.shadow
    .filter((row) => row.status === "active")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12)
    .map((row) => `[${row.kind}] ${row.claim}`);
  return {
    ...samost,
    light: light.length ? light : samost.light,
    shadow: shadow.length ? shadow : samost.shadow,
  };
}

/** Migrate legacy free-text samost lines into typed ledger once. */
export function migrateSamostLines(ledger: SelfLedger, samost: Samost): SelfLedger {
  if (ledger.light.length || ledger.shadow.length) return ledger;
  let next = ledger;
  for (const line of samost.light) {
    if (/not yet disclosed/i.test(line)) continue;
    next = upsertLight(next, {
      kind: "domain",
      claim: line,
      refs: [`legacy:light:${hash(line)}`],
      confidence: 0.4,
      band: "ok",
    });
  }
  for (const line of samost.shadow) {
    next = upsertShadow(next, {
      kind: "fail",
      claim: line,
      refs: [`legacy:shadow:${hash(line)}`],
      weight: 1,
      pathChanged: true,
    });
  }
  return next;
}

export function formatProjectedSamost(samost: Samost, ledger: SelfLedger): string {
  return formatSamost(projectSamost(samost, ledger));
}

export function absorbLegacyShadow(samost: Samost, line: string): Samost {
  return absorbIntoSamost(samost, line, "shadow");
}

export { parseSamost, seedSamost };

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((token) => token.split("-"))
    .filter((token) => token.length > 3);
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).slice(0, 8);
}
